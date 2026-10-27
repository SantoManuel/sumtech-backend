import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OnuOpticalHistoryEntity } from '../entities/onu-optical-history.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { VlanEntity } from '../entities/vlan.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { ListUnconfiguredOnusDto, ListOnusDto } from '../dto/list-onus.dto';
import { MigrateOnuDto } from '../dto/migrate-onu.dto';
import { NetworkAccessEntity } from '../../network/entities/network-access.entity';
import { NapPortEntity } from '../../network/entities/nap-port.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { CpeConfiguratorService } from '../../genieacs/services/cpe-configurator.service';
import { resolveCpeIpv6Capabilities } from '../../genieacs/services/cpe-capabilities';
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import {
  IOltDriver,
  AuthorizeOnuParams,
  DriverNotImplementedError,
  UnknownOltVendorError,
} from '../ports/olt-driver.port';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';

@Injectable()
export class OnuManagementService {
  private readonly logger = new Logger(OnuManagementService.name);

  constructor(
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    @InjectRepository(OnuServiceConfigEntity)
    private readonly configRepository: Repository<OnuServiceConfigEntity>,
    @InjectRepository(OnuOpticalHistoryEntity)
    private readonly opticalHistoryRepository: Repository<OnuOpticalHistoryEntity>,
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(OltInterfaceEntity)
    private readonly ifaceRepository: Repository<OltInterfaceEntity>,
    @InjectRepository(OnuTypeEntity)
    private readonly onuTypeRepository: Repository<OnuTypeEntity>,
    @InjectRepository(OltSpeedProfileEntity)
    private readonly speedProfileRepository: Repository<OltSpeedProfileEntity>,
    @InjectRepository(VlanEntity)
    private readonly vlanRepository: Repository<VlanEntity>,
    @InjectRepository(Tr069NetworkEntity)
    private readonly tr069Repository: Repository<Tr069NetworkEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(NetworkAccessEntity)
    private readonly networkAccessRepository: Repository<NetworkAccessEntity>,
    @InjectRepository(NapPortEntity)
    private readonly napPortRepository: Repository<NapPortEntity>,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly connectionResolver: OltConnectionResolverService,
    private readonly deviceOperationLogger: DeviceOperationLogger,
    private readonly cpeConfiguratorService: CpeConfiguratorService,
    private readonly genieAcsDeviceResolver: GenieAcsDeviceResolverService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Resuelve el driver real del fabricante de la OLT dueña de la ONU/operación.
   * Nunca cae silenciosamente en ZteC320Driver para un vendor desconocido.
   */
  private resolveDriver(olt: OltEntity): IOltDriver {
    try {
      return this.driverRegistry.resolve(olt.vendor);
    } catch (err) {
      if (err instanceof UnknownOltVendorError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  /** Traduce DriverNotImplementedError a un 501 explícito en vez de un 500 genérico. */
  private async callDriver<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err: any) {
      if (err instanceof DriverNotImplementedError) {
        throw new HttpException({ code: err.code, message: err.message }, HttpStatus.NOT_IMPLEMENTED);
      }
      throw err;
    }
  }

  /**
   * Consulta ONUs sin configurar descubiertas por OLT o por ACS (RF-OLT-014).
   * `olt`/`ponInterface` son ManyToOne (un único row por ONU) -- skip/take
   * directo sobre `find()` pagina ONUs reales, sin el riesgo de
   * multiplicación por join que sí aplica a relaciones OneToMany (ver
   * OltManagementService.findAll).
   */
  async findUnconfigured(dto?: ListUnconfiguredOnusDto) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = { status: 'UNCONFIGURED' };
    if (dto?.oltId) where.oltId = dto.oltId;

    const [data, total] = await this.onuRepository.findAndCount({
      where,
      // 'olt.zone' -- así el frontend conoce la zona de la OLT sin un
      // round-trip extra, para autogenerar la "description" (ver
      // docs/onu-tr069-provisioning-zte-c320.md) antes de autorizar.
      relations: ['olt', 'olt.zone', 'ponInterface'],
      order: { detectedAt: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Listado general de ONUs con filtros opcionales. Todas las relaciones
   * unidas (`olt`, `ponInterface`, `onuType`, `contract`, `contract.client`,
   * `serviceConfig`) son ManyToOne/OneToOne -- sin riesgo de multiplicación
   * por join al paginar con skip/take directo.
   */
  async findAll(dto?: ListOnusDto) {
    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.onuRepository
      .createQueryBuilder('onu')
      .leftJoinAndSelect('onu.olt', 'olt')
      .leftJoinAndSelect('onu.ponInterface', 'ponInterface')
      .leftJoinAndSelect('onu.onuType', 'onuType')
      .leftJoinAndSelect('onu.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('onu.serviceConfig', 'serviceConfig')
      .orderBy('onu.updatedAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (dto?.oltId) {
      qb.andWhere('onu.oltId = :oltId', { oltId: dto.oltId });
    }
    if (dto?.status) {
      // Acepta un único status ("ACTIVE") o una lista separada por comas
      // ("ACTIVE,BLOCKED,OFFLINE") -- usado por la pestaña "ONUs
      // Aprovisionadas" de /dashboard/red para pedir explícitamente "todo
      // menos UNCONFIGURED" sin reinterpretar "sin filtro" como "todos los
      // estados" (antes incluía UNCONFIGURED en una vista que por nombre no
      // debería mostrarlas -- ver bug reportado 2026-10-17).
      const statuses = dto.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (statuses.length > 1) {
        qb.andWhere('onu.status IN (:...statuses)', { statuses });
      } else {
        qb.andWhere('onu.status = :status', { status: statuses[0] });
      }
    }
    if (dto?.search) {
      const rawSearch = dto.search.trim();
      if (rawSearch) {
        const q = `%${rawSearch}%`;
        const cleanRaw = rawSearch.replace(/[:.\-\s]/g, '');
        const cleanQ = cleanRaw ? `%${cleanRaw}%` : q;

        // Buscador 360° Universal: serial (con/sin dos puntos o guiones), MAC,
        // nombre asignado en OLT (onu.name), descripción/zona (onu.description),
        // nombre de cliente (client.name), cédula/RNC (client.docNumber), contrato
        // (contract.contractNumber), índice óptico (onu.onuIndex), interfaz PON
        // (ponInterface.name), OLT (olt.name) y modelo (onuType.modelName).
        qb.andWhere(
          `(
            onu.serialNumber ILIKE :q
            OR REPLACE(onu.serialNumber, ':', '') ILIKE :cleanQ
            OR REPLACE(onu.serialNumber, '-', '') ILIKE :cleanQ
            OR onu.mac ILIKE :q
            OR REPLACE(onu.mac, ':', '') ILIKE :cleanQ
            OR onu.name ILIKE :q
            OR onu.description ILIKE :q
            OR client.name ILIKE :q
            OR client.docNumber ILIKE :cleanQ
            OR contract.contractNumber ILIKE :q
            OR onu.onuIndex ILIKE :q
            OR ponInterface.name ILIKE :q
            OR olt.name ILIKE :q
            OR onuType.modelName ILIKE :q
          )`,
          { q, cleanQ },
        );
      }
    }

    // Entidad cruda (serialNumber/mac/onuIndex/ponInterface/onuType/rxPowerDbm/
    // contract.client/...) dentro de `data` -- NO mapear cada fila a una forma
    // "limpia": la tabla "ONUs / Fibra" de /dashboard/red (fetchAllOnus en
    // red/page.tsx) depende de estos nombres exactos desde antes de este
    // método existir. El selector de ONU de ConfigureNetworkAccessModal (el
    // otro consumidor de este mismo endpoint) lee estos mismos nombres crudos
    // -- no renombrar los campos de cada fila sin verificar AMBOS consumidores
    // primero (ver git blame de este bloque: una mapeada "forma limpia" aquí
    // rompió esa tabla en silencio). El propio SOBRE {data,total,...} sí es
    // nuevo (paginación) -- ambos consumidores ya fueron actualizados para
    // leer `res.data.data` en vez de `res.data` directamente.
    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string) {
    const onu = await this.onuRepository.findOne({
      where: { id },
      relations: [
        'olt',
        'ponInterface',
        'onuType',
        'contract',
        'contract.client',
        'napPort',
        'napPort.nap',
        'serviceConfig',
        'serviceConfig.serviceVlan',
        'serviceConfig.tr069Vlan',
        'serviceConfig.tr069Network',
        'serviceConfig.speedProfile',
      ],
    });
    if (!onu) {
      throw new NotFoundException(`ONU no encontrada: ${id}`);
    }
    if (onu.olt) {
      this.driverRegistry.attachCapabilities(onu.olt);
    }

    const cpeCaps = resolveCpeIpv6Capabilities(onu.vendor, onu.onuType?.model);
    (onu as any).cpeIpv6Capabilities = cpeCaps.capabilities;
    (onu as any).cpeIpv6CapabilityNotes = cpeCaps.notes;

    // BUG REAL corregido (2026-10-25): `onu.genieacsDeviceId` (columna propia
    // de net.onus) nunca se escribe en ningún lugar del backend -- el
    // vínculo real con GenieACS vive en net.genieacs_devices, indexado por
    // contractId (ver GenieAcsDeviceResolverService, que SÍ se mantiene
    // sincronizado vía GenieAcsReconciliationService). Sin esto, la Ficha 360
    // mostraba "CPE SIN CONECTAR" para equipos que llevaban horas reportando
    // con éxito a GenieACS -- confirmado en vivo contra un ONU real
    // (CMDCDD4D131E / contrato CTR-394574) cuyo genieacs_devices.genieacs_
    // device_id SÍ estaba poblado mientras onus.genieacs_device_id seguía NULL.
    if (onu.contract?.id) {
      const genieAcsDevice = await this.genieAcsDeviceResolver.findByContractId(onu.contract.id);
      if (genieAcsDevice?.genieacsDeviceId) {
        onu.genieacsDeviceId = genieAcsDevice.genieacsDeviceId;
      }
    }

    return onu;
  }

  /**
   * Escanea ONUs no configuradas en una OLT (RF-OLT-014).
   */
  async scanUnconfiguredOnus(oltId: string, actorUserId?: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException(`OLT no encontrada: ${oltId}`);

    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);
    const discovered = await withOltTelnetLock(olt.id, () =>
      this.callDriver(() => driver.getUnconfiguredOnus(connParams)),
    );

    const savedOnus: OnuEntity[] = [];

    for (const item of discovered) {
      const existing = await this.onuRepository.findOneBy({
        oltId: olt.id,
        serialNumber: item.serialNumber,
      });

      // Buscar interfaz PON correspondiente en la base de datos
      const ponIface = await this.ifaceRepository.findOneBy({
        oltId: olt.id,
        name: item.ponInterface,
      });

      if (!existing) {
        const created = this.onuRepository.create({
          oltId: olt.id,
          ponInterfaceId: ponIface?.id,
          onuIndex: item.onuIndex,
          serialNumber: item.serialNumber,
          vendor: item.vendor,
          status: 'UNCONFIGURED',
          detectedBy: 'OLT_POLL',
          detectedAt: new Date(),
        });
        savedOnus.push(await this.onuRepository.save(created));
        continue;
      }

      // UPDATE dirigido solo a estos 3 campos -- NUNCA un save(existing)
      // completo. `existing` se leyó al INICIO de este loop, y el escaneo de
      // una OLT con varios puertos PON implica varias sesiones Telnet reales
      // que pueden tardar segundos. Si en esa ventana alguien autoriza esta
      // misma ONU (status pasa a ACTIVE en la BD real), un save() de la
      // entidad completa reescribe TODAS sus columnas con el snapshot viejo
      // en memoria -- revirtiendo la autorización a UNCONFIGURED en
      // silencio, sin error visible (bug real confirmado en producción,
      // 2026-10-17). Mismo criterio ya usado en getOpticalTelemetry().
      const lastSeenAt = new Date();
      await this.onuRepository.update(existing.id, {
        onuIndex: item.onuIndex,
        ...(ponIface ? { ponInterfaceId: ponIface.id } : {}),
        lastSeenAt,
      });
      existing.onuIndex = item.onuIndex;
      if (ponIface) existing.ponInterfaceId = ponIface.id;
      existing.lastSeenAt = lastSeenAt;
      savedOnus.push(existing);
    }

    // Reconciliación inversa -- bug real confirmado (2026-10-23): hasta acá
    // este método era puramente aditivo (solo inserta/actualiza lo que la
    // OLT SÍ reporta ahora mismo como sin configurar), pero nunca limpiaba
    // lo contrario -- una fila "UNCONFIGURED" se quedaba así PARA SIEMPRE en
    // la Bandeja Sin Configurar aunque la OLT ya no la reportara (ONU
    // autorizada por fuera de la app, ej. directo por Telnet, o
    // simplemente desconectada físicamente). Se filtra por
    // `status: 'UNCONFIGURED'` EN ESTE MOMENTO (no con el snapshot de
    // `discovered` leído arriba) para no pisar una autorización concurrente
    // que ya haya promovido la fila a ACTIVE mientras corría este escaneo --
    // mismo cuidado que ya tiene el UPDATE dirigido de arriba. Solo borra
    // filas nunca autorizadas por la app (ACTIVE/BLOCKED/OFFLINE no se tocan
    // jamás acá); eliminar en vez de reescribir evita inventar un estado
    // que esta función, que solo sabe de "sin configurar", no puede inferir.
    const discoveredSerials = new Set(discovered.map((item) => item.serialNumber));
    const staleUnconfigured = (
      await this.onuRepository.find({ where: { oltId: olt.id, status: 'UNCONFIGURED' } })
    ).filter((onu) => !discoveredSerials.has(onu.serialNumber));
    if (staleUnconfigured.length > 0) {
      try {
        await this.onuRepository.remove(staleUnconfigured);
      } catch (err: any) {
        this.logger.warn(
          `[diag] scanUnconfiguredOnus: no se pudieron limpiar ${staleUnconfigured.length} fila(s) "UNCONFIGURED" obsoleta(s) de la OLT "${olt.name}": ${err.message}`,
        );
      }
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message:
        `[${olt.vendor}] Escaneo de ONUs sin configurar en OLT "${olt.name}": ${discovered.length} detectadas` +
        `${staleUnconfigured.length > 0 ? `, ${staleUnconfigured.length} obsoleta(s) limpiada(s)` : ''}.`,
      actorUserId,
      rawDetails: { oltId: olt.id, vendor: olt.vendor, driverName: driver.constructor.name, operation: 'scanUnconfiguredOnus' },
    });

    return savedOnus;
  }

  /**
   * Importación pasiva de ONUs ya autorizadas en un puerto PON (brownfield:
   * sitio con clientes ya provistos por otro sistema antes de migrar a
   * Sumtech). A diferencia de scanUnconfiguredOnus(), NUNCA llama a
   * authorizeOnu() ni emite ningún comando de escritura en la OLT -- solo
   * lee lo que el equipo ya reporta como autorizado y lo refleja en net.onus
   * como ACTIVE (o BLOCKED si la OLT lo reporta deshabilitado), sin
   * contractId ni authorizedAt: vincular la ONU a un cliente real queda como
   * paso manual del operador, porque no hay forma confiable de inferirlo
   * desde la OLT. Las ONUs que ya existen en nuestra base (por serial) se
   * omiten por completo -- esto nunca debe tocar un registro existente.
   */
  async scanAuthorizedOnus(oltId: string, ponInterface: string, actorUserId?: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException(`OLT no encontrada: ${oltId}`);

    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const discovered = await withOltTelnetLock(olt.id, () =>
      this.callDriver(() => {
        if (!driver.getAuthorizedOnus) {
          throw new DriverNotImplementedError(olt.vendor, 'getAuthorizedOnus');
        }
        return driver.getAuthorizedOnus(connParams, ponInterface);
      }),
    );

    const ponIface = await this.ifaceRepository.findOneBy({ oltId: olt.id, name: ponInterface });

    const imported: OnuEntity[] = [];
    for (const item of discovered) {
      const existing = await this.onuRepository.findOneBy({ oltId: olt.id, serialNumber: item.serialNumber });
      if (existing) {
        if ((!existing.name && item.name) || (!existing.description && item.description)) {
          await this.onuRepository.update(existing.id, {
            name: existing.name || item.name,
            description: existing.description || item.description,
          });
        }
        continue;
      }

      const created = this.onuRepository.create({
        oltId: olt.id,
        ponInterfaceId: ponIface?.id,
        onuIndex: item.onuIndex,
        serialNumber: item.serialNumber,
        vendor: item.vendor,
        name: item.name,
        description: item.description,
        status: item.adminState === 'DISABLE' ? 'BLOCKED' : 'ACTIVE',
        detectedBy: 'OLT_IMPORT',
        detectedAt: new Date(),
        lastSeenAt: new Date(),
      });
      imported.push(await this.onuRepository.save(created));
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Importación pasiva de ONUs ya autorizadas en ${ponInterface}: ${imported.length} nueva(s) de ${discovered.length} detectada(s) en la OLT.`,
      actorUserId,
      rawDetails: {
        oltId: olt.id,
        vendor: olt.vendor,
        ponInterface,
        discoveredCount: discovered.length,
        importedCount: imported.length,
        operation: 'scanAuthorizedOnus',
      },
    });

    return imported;
  }

  /**
   * Vincula una ONU ya ACTIVE (típicamente importada vía scanAuthorizedOnus,
   * sin contrato) a un contrato real -- paso manual porque no hay forma
   * confiable de inferir el cliente desde lo que reporta la OLT. Deliberadamente
   * NO reusa reprovisionOnu(): esa operación exige que ya exista una fila en
   * onu_service_config (VLAN/perfil de servicio), que una ONU importada
   * nunca tiene -- esto es más simple a propósito: solo toca contractId, sin
   * tocar la OLT ni crear config de servicio.
   */
  async linkOnuToContract(id: string, contractId: string, actorUserId?: string) {
    const onu = await this.findById(id);
    if (onu.status !== 'ACTIVE') {
      throw new BadRequestException('Solo se puede vincular a un contrato una ONU que ya esté autorizada (ACTIVE).');
    }
    if (onu.contractId) {
      throw new BadRequestException('Esta ONU ya está vinculada a un contrato.');
    }

    const contract = await this.contractRepository.findOneBy({ id: contractId });
    if (!contract) {
      throw new NotFoundException(`Contrato no encontrado: ${contractId}`);
    }

    await this.onuRepository.update(onu.id, { contractId });

    await this.deviceOperationLogger.logEvent({
      nodeId: onu.olt.viaNodeId || onu.olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `ONU ${onu.serialNumber} vinculada manualmente al contrato ${contract.contractNumber}.`,
      actorUserId,
      rawDetails: { onuId: onu.id, contractId, operation: 'linkOnuToContract' },
    });

    return this.findById(onu.id);
  }

  /**
   * Obtiene la telemetría de potencia óptica en vivo (RF-OLT-015).
   */
  async getOpticalTelemetry(id: string) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const connParams = await this.connectionResolver.resolve(onu.olt);

    const onuTarget = this.buildOnuTarget(onu);

    const power = await this.callDriver(() => driver.getOnuOpticalPower(connParams, onuTarget));

    if (power.rxDbm !== undefined) {
      onu.rxPowerDbm = power.rxDbm;
    }
    if (power.txDbm !== undefined) {
      onu.txPowerDbm = power.txDbm;
    }
    onu.lastSeenAt = new Date();
    // .update() en vez de save(onu): ver nota en authorizeOnu() sobre por qué
    // save() de una entidad con la relación serviceConfig cargada puede
    // disparar un UPDATE accidental sobre onu_service_config.
    await this.onuRepository.update(onu.id, {
      rxPowerDbm: onu.rxPowerDbm,
      txPowerDbm: onu.txPowerDbm,
      lastSeenAt: onu.lastSeenAt,
    });

    if (power.rxDbm !== undefined) {
      try {
        await this.opticalHistoryRepository.save(
          this.opticalHistoryRepository.create({
            onuId: onu.id,
            rxPowerDbm: power.rxDbm,
            txPowerDbm: power.txDbm,
            attenuationDb: power.attenuationDb,
            recordedAt: new Date(),
          }),
        );
      } catch (err: any) {
        this.logger.warn(`No se pudo persistir histórico óptico para ONU ${onu.id}: ${err.message}`);
      }
    }

    return {
      onuId: onu.id,
      serialNumber: onu.serialNumber,
      onuIndex: onu.onuIndex,
      rxPowerDbm: onu.rxPowerDbm,
      txPowerDbm: onu.txPowerDbm,
      downRxDbm: power.downRxDbm,
      upRxDbm: power.upRxDbm,
      attenuationDb: power.attenuationDb,
      lastSeenAt: onu.lastSeenAt,
      signalStatus:
        onu.rxPowerDbm && onu.rxPowerDbm < -27
          ? 'CRITICAL_LOW'
          : onu.rxPowerDbm && onu.rxPowerDbm < -24
          ? 'WARNING'
          : 'OPTIMAL',
    };
  }

  /**
   * Obtiene la serie temporal de histórico de potencia óptica (SmartOLT benchmark Sección 5.3).
   */
  async getOpticalHistory(id: string, days: number = 30) {
    const onu = await this.findById(id);
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

    const history = await this.opticalHistoryRepository.find({
      where: {
        onuId: onu.id,
        recordedAt: MoreThanOrEqual(since),
      },
      order: { recordedAt: 'ASC' },
      take: 100,
    });

    if (history.length === 0 && onu.rxPowerDbm !== null && onu.rxPowerDbm !== undefined) {
      return [
        {
          recordedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          rxPowerDbm: onu.rxPowerDbm,
          txPowerDbm: onu.txPowerDbm || 2.5,
          attenuationDb: 18.5,
        },
        {
          recordedAt: new Date().toISOString(),
          rxPowerDbm: onu.rxPowerDbm,
          txPowerDbm: onu.txPowerDbm || 2.5,
          attenuationDb: 18.5,
        },
      ];
    }

    return history.map((h) => ({
      recordedAt: h.recordedAt.toISOString(),
      rxPowerDbm: h.rxPowerDbm,
      txPowerDbm: h.txPowerDbm,
      attenuationDb: h.attenuationDb,
    }));
  }

  /**
   * Genera el script de comandos Telnet para previsualizar antes de ejecutar (RF-OLT-018 dry-run).
   */
  async previewAuthorizationScript(id: string, dto: any) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const config = await this.buildAuthorizeParams(onu, dto);
    const commands = await this.callDriver(async () => driver.generateAuthorizationScript(config));

    return {
      onuId: onu.id,
      serialNumber: onu.serialNumber,
      commands,
      totalCommands: commands.length,
    };
  }

  /**
   * Autoriza y provisiona la ONU en la OLT (RF-OLT-016 / RF-ONU-001 a 007).
   */
  async authorizeOnu(id: string, dto: any, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const authParams = await this.buildAuthorizeParams(onu, dto);

    // 1. Provisión en la OLT vía Telnet
    const result = await driver.authorizeOnu(connParams, authParams);
    if (!result.ok) {
      throw new BadRequestException(`Fallo aprovisionando ONU en OLT: ${result.error}`);
    }
    // `result.warning` (ver IOltDriver.authorizeOnu): un paso de mejor
    // esfuerzo no crítico (hoy, en ZTE: el push OMCI de TR-069/ACS) falló sin
    // abortar el resto -- se surte igual que `cpeConfigWarning` más abajo.
    const oltWarning = result.warning;

    // 2. Persistir configuración de servicio en net.onu_service_config.
    // `OnuAuthorizeModal.tsx` (Etapa 1 del frontend, 2026-10-24) ya puede
    // mandar `tr069NetworkId`: si lo trae, el driver (`generateAuthorizationScript`,
    // guardia `hasTr069`) aplicó TODO -- internet + canal de gestión +
    // bloque TR-069/ACS -- en la MISMA llamada de arriba, sin necesitar
    // `applyTr069Profile()` (Etapa 2, que pasa a ser solo un reintento
    // aislado). Por eso managementMethod/tr069NetworkId/tr069VlanId SÍ se
    // actualizan aquí cuando `dto.tr069NetworkId` viene presente -- de lo
    // contrario la Ficha 360 seguía mostrando "Gestión Remota: OMCI" /
    // "VLAN TR-069: —" aunque la OLT ya tuviera el ONT apuntando al ACS
    // (bug real encontrado revisando la Ficha 360 de CMDCDD4D131E). Sin
    // `tr069NetworkId` en el dto (caso histórico, o una ONU que no usa
    // TR-069), esos 3 campos no se tocan -- preservan lo que las etapas 2/3
    // ya hayan aplicado antes. `wanMode` sigue siendo exclusivo de la Etapa 3.
    const speedProfileId = dto.speedProfileId || undefined;

    // Si este dto YA trae una Red TR-069 (Etapa 1 fusionada, ver `hasTr069`
    // en el driver), hay que persistir managementMethod/tr069NetworkId/
    // tr069VlanId igual que ya hace `applyTr069Profile()` -- sin esto, el
    // driver aplicaba TR-069 de verdad en la OLT pero la Ficha 360 seguía
    // mostrando "Gestión Remota: OMCI" / "VLAN TR-069: —" porque nada acá
    // escribía esos campos (bug real encontrado revisando la Ficha 360 de
    // CMDCDD4D131E, 2026-10-24). `tr069VlanId` es el UUID del VlanEntity
    // (no el ID numérico 802.1Q) -- mismo campo, mismo motivo que ya
    // documenta `applyTr069Profile()`.
    let tr069VlanId: string | undefined;
    if (dto.tr069NetworkId) {
      const tr069Network = await this.tr069Repository.findOneBy({ id: dto.tr069NetworkId });
      tr069VlanId = tr069Network?.vlanId;
    }

    let config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      config = this.configRepository.create({
        onuId: onu.id,
        serviceVlanId: dto.serviceVlanId,
        managementMethod: dto.tr069NetworkId ? 'TR069' : 'OMCI',
        tr069NetworkId: dto.tr069NetworkId || undefined,
        tr069VlanId,
        operationMode: dto.operationMode || 'ROUTER',
        speedProfileId,
        desiredVersion: 1,
        appliedVersion: 1,
        applyStatus: 'APPLIED',
      });
    } else {
      config.serviceVlanId = dto.serviceVlanId;
      config.operationMode = dto.operationMode || config.operationMode;
      config.speedProfileId = speedProfileId;
      if (dto.tr069NetworkId) {
        config.managementMethod = 'TR069';
        config.tr069NetworkId = dto.tr069NetworkId;
        config.tr069VlanId = tr069VlanId;
      }
      config.appliedVersion += 1;
      config.desiredVersion = config.appliedVersion;
      config.applyStatus = 'APPLIED';
    }
    await this.configRepository.save(config);

    // 3. Actualizar estado de la ONU en net.onus
    // .update() en vez de save(onu): onu.serviceConfig quedó cargado (join de
    // findById) desde ANTES de crear/actualizar `config` arriba — save(onu)
    // reconsulta la relación OneToOne inversa y, al verla distinta de la fila
    // que acabamos de insertar/tocar en onu_service_config, TypeORM la trata
    // como huérfana y emite "UPDATE onu_service_config SET onu_id = NULL"
    // (orphanedRowAction por defecto), lo que viola el NOT NULL de esa
    // columna — causa real de los 500 intermitentes en este endpoint. update()
    // es un UPDATE de columnas directo, nunca toca relaciones.
    onu.status = 'ACTIVE';
    onu.authorizedAt = new Date();
    onu.authorizedByUserId = actorUserId;
    onu.contractId = dto.contractId || onu.contractId;
    onu.onuTypeId = dto.onuTypeId || onu.onuTypeId;
    if (dto.onuIndex) onu.onuIndex = dto.onuIndex;
    onu.name = authParams.clientName || onu.name;
    onu.description = authParams.description || onu.description;

    await this.onuRepository.update(onu.id, {
      status: onu.status,
      authorizedAt: onu.authorizedAt,
      authorizedByUserId: onu.authorizedByUserId,
      contractId: onu.contractId,
      onuTypeId: onu.onuTypeId,
      onuIndex: onu.onuIndex,
      name: onu.name,
      description: onu.description,
    });

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ONU ${onu.serialNumber} autorizada con éxito en ${authParams.ponInterface}:${authParams.onuId}`,
      actorUserId,
      rawDetails: {
        onuId: onu.id,
        serialNumber: onu.serialNumber,
        oltId: olt.id,
        vendor: olt.vendor,
        driverName: driver.constructor.name,
        operation: 'authorizeOnu',
      },
    });

    // Ya NO se empuja nada a GenieACS acá -- eso es ahora la Etapa 2
    // (`applyTr069Profile`, apunta el ONU al ACS) y la Etapa 3
    // (`pushWanConfig`, envía WAN/PPPoE), ambas acciones separadas e
    // independientemente reintentables desde la Ficha 360 de la ONU, en vez
    // de dispararse automáticamente acá con el riesgo de fallar porque el
    // equipo recién autorizado todavía no le reportó nada al ACS.
    const saved = await this.findById(onu.id);
    return { ...saved, oltWarning };
  }

  /**
   * Empuja WAN/PPPoE/WiFi y los tags `TENANT:<slug>`/`OLT:<nombre>` al CPE
   * vía GenieACS (RF-OLT-013) -- extraído de `authorizeOnu()`/`reprovisionOnu()`,
   * que antes duplicaban este bloque casi línea por línea. Siempre "mejor
   * esfuerzo": nunca lanza, y persiste el resultado real en
   * `config.cpeConfigStatus` (distinto de `config.applyStatus`, que es del
   * lado OLT) para que `OnuCpeSyncReconciliationService` sepa qué ONUs
   * reintentar. No-op (`{}`) si la ONU no usa gestión TR-069.
   *
   * Público (no privado) a propósito: `OnuCpeSyncReconciliationService` lo
   * reutiliza para reintentar automáticamente, sin duplicar de nuevo esta
   * lógica.
   */
  async pushCpeConfiguration(
    onu: OnuEntity,
    config: OnuServiceConfigEntity,
    olt: OltEntity,
    wanStatic: {
      wanStaticIp?: string;
      wanStaticMask?: string;
      wanStaticGw?: string;
      wanStaticIpv6?: string;
      wanStaticIpv6PrefixLen?: number;
      wanStaticIpv6Gw?: string;
      wanStaticIpv6Dns1?: string;
      wanStaticIpv6Dns2?: string;
    },
    options: { warningPrefix: string; failureLogMessagePrefix: string; operation: string; actorUserId?: string },
  ): Promise<{ cpeConfigured?: boolean; cpeConfigWarning?: string }> {
    if (config.managementMethod !== 'TR069' || !config.tr069NetworkId) {
      return {};
    }

    try {
      const tr069Network = await this.tr069Repository.findOneBy({ id: config.tr069NetworkId });
      if (!tr069Network) {
        throw new Error(`Red TR-069 "${config.tr069NetworkId}" no encontrada.`);
      }
      const onuType = onu.onuTypeId ? await this.onuTypeRepository.findOneBy({ id: onu.onuTypeId }) : null;
      const wanMode = config.wanMode || 'PPPOE';

      // PPPoE: usuario/contraseña vienen del network_access ya vinculado al
      // contrato (única fuente de verdad, ver Plan_Implementacion_Red_RF.md
      // §8 Fase 8) -- nunca se piden de nuevo en este modal para no terminar
      // con dos credenciales PPPoE distintas (la del secret en RouterOS y la
      // que el propio ONU usa) para el mismo acceso.
      let pppoeUsername: string | undefined;
      let pppoePassword: string | undefined;
      if (wanMode === 'PPPOE' && onu.contractId) {
        const networkAccess = await this.networkAccessRepository.findOneBy({ contractId: onu.contractId });
        if (networkAccess) {
          pppoeUsername = networkAccess.username || undefined;
          pppoePassword = networkAccess.pppoePasswordEnc
            ? decryptCredential(networkAccess.pppoePasswordEnc)
            : undefined;
        }
      }

      let serviceVlan = 100;
      if (config.serviceVlanId) {
        const v = await this.vlanRepository.findOneBy({ id: config.serviceVlanId });
        if (v) serviceVlan = v.vlanId;
      }

      const configureResult = await this.cpeConfiguratorService.configureCpe({
        serialNumber: onu.serialNumber,
        vendor: onuType?.vendor,
        model: onuType?.model,
        // Dispara los tags TENANT:<slug>/OLT:<nombre> en GenieACS (ver
        // CpeConfiguratorService.configureCpe) — único mecanismo real para
        // saber a qué tenant/OLT pertenece un CPE, dado que GenieACS es una
        // sola instancia compartida por todos los tenants.
        tenantSlug: this.tenantContext.getSlug(),
        oltName: olt.name,
        operationMode: config.operationMode || 'ROUTER',
        ipProtocol: config.ipProtocol,
        wanMode,
        pppoeUsername,
        pppoePassword,
        wanStaticIp: wanMode === 'STATIC' ? wanStatic.wanStaticIp : undefined,
        wanStaticMask: wanMode === 'STATIC' ? wanStatic.wanStaticMask : undefined,
        wanStaticGw: wanMode === 'STATIC' ? wanStatic.wanStaticGw : undefined,
        dns1: config.wanDns1,
        dns2: config.wanDns2,
        serviceVlan,
        managementServer: {
          acsUrl: tr069Network.acsUrl,
          acsUsername: tr069Network.acsUsername || undefined,
          acsPassword: tr069Network.acsPasswordEnc ? decryptCredential(tr069Network.acsPasswordEnc) : undefined,
          connReqUsername: tr069Network.connReqUsername || undefined,
          connReqPassword: tr069Network.connReqPasswordEnc
            ? decryptCredential(tr069Network.connReqPasswordEnc)
            : undefined,
          informIntervalSec: tr069Network.informIntervalSec,
        },
      });

      if (configureResult.ipv6Readback?.prefix) {
        config.pppoeIpv6Prefix = configureResult.ipv6Readback.prefix;
      }
      if (configureResult.ipv6Readback?.address) {
        config.pppoeIpv6Address = configureResult.ipv6Readback.address;
      }
      config.cpeConfigStatus = 'APPLIED';
      config.lastCpeConfigError = undefined;
      config.cpeConfigSyncedAt = new Date();
      await this.configRepository.save(config);

      // Aviso no fatal (ej. Dual-Stack pedido en DHCP/STATIC, todavía sin
      // implementar -- ver CpeParameterMapper.getIpv6Warning). La
      // configuración SÍ se aplicó; esto solo avisa qué parte se ignoró.
      return { cpeConfigured: true, cpeConfigWarning: configureResult.warning };
    } catch (err: any) {
      await this.deviceOperationLogger.logEvent({
        nodeId: olt.viaNodeId || olt.id,
        eventType: 'PROVISION',
        status: 'FAILURE',
        message: `${options.failureLogMessagePrefix}: ${err.message}`,
        actorUserId: options.actorUserId,
        rawDetails: { onuId: onu.id, oltId: olt.id, operation: options.operation },
      });

      config.cpeConfigStatus = 'ERROR';
      config.lastCpeConfigError = err.message;
      await this.configRepository.save(config);

      return { cpeConfigured: false, cpeConfigWarning: `${options.warningPrefix}: ${err.message}` };
    }
  }

  /**
   * Etapa 2 del flujo de 3 etapas: apunta una ONU YA autorizada ópticamente
   * (Etapa 1, `authorizeOnu`) al ACS (chain OMCI de `tr069-mgmt`) -- SIN
   * tocar GenieACS/WAN todavía (eso es `pushWanConfig`, Etapa 3). Permite
   * reintentar este paso de forma independiente, sin re-autorizar la ONU
   * en la OLT cada vez.
   */
  async applyTr069Profile(id: string, dto: { tr069NetworkId: string }, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    // A diferencia de "Solo actualizar ACS" (updateTr069AcsUrl), esta acción SÍ
    // re-cablea tcont/gemport/service-port/flow/veip con el serviceVlanId/
    // speedProfileId de `config` -- auto-crear la fila acá con valores
    // adivinados arriesgaría empujarle a un equipo de producción ya cableado
    // (ej. detectedBy=OLT_IMPORT) una VLAN distinta a la real. Por eso este
    // camino se queda bloqueado sin una fila real, a diferencia del otro.
    const config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      throw new BadRequestException(
        'Esta ONU no tiene configuración de servicio previa en el sistema. Si es un equipo nuevo, autorízalo en la OLT primero. ' +
          'Si es un equipo de producción que YA está cableado en la OLT (ej. importado por escaneo) y solo necesitas apuntarlo a un ACS distinto, usa el botón "Solo actualizar ACS" de este mismo modal -- esa acción no re-cablea VLAN/tcont y no requiere conocer la configuración previa.',
      );
    }
    if (!dto.tr069NetworkId) {
      throw new BadRequestException('Selecciona una Red TR-069.');
    }

    const authParams = await this.buildAuthorizeParams(onu, {
      onuTypeId: onu.onuTypeId,
      serviceVlanId: config.serviceVlanId,
      speedProfileId: config.speedProfileId,
      tr069NetworkId: dto.tr069NetworkId,
      managementMethod: 'TR069',
      operationMode: config.operationMode,
    });

    // Falla aquí, ANTES de conectarse a la OLT, en vez de dejar que el
    // driver genere "tr069-mgmt 1 acs " en blanco (la OLT lo aceptaría sin
    // quejarse -- es solo texto para ella -- y la ONU quedaría "configurada"
    // sin apuntar a ningún lado). Señal de una Red TR-069 con "acsUrl" vacío.
    if (!authParams.tr069Url) {
      throw new BadRequestException(
        `La Red TR-069 seleccionada no tiene una URL de ACS configurada (acsUrl vacío). Corrígela en "Redes TR-069" antes de aplicar el perfil.`,
      );
    }

    const result = await this.callDriver(() => driver.applyTr069Management(connParams, authParams));
    if (!result.ok) {
      throw new BadRequestException(`Fallo aplicando el Perfil TR-069 en la OLT: ${result.error}`);
    }

    config.managementMethod = 'TR069';
    config.tr069NetworkId = dto.tr069NetworkId;
    // Bug real confirmado (2026-10-23): esto nunca se asignaba, así que
    // "VLAN TR-069" en la Ficha 360 siempre salía vacío ("VLAN —") pese a
    // que la ONU SÍ tenía una Red TR-069 aplicada -- findById() ya carga la
    // relación "serviceConfig.tr069Vlan", pero con la FK en null nunca
    // resuelve nada. authParams.tr069Vlan solo trae el ID numérico de VLAN
    // (802.1Q, ej. 46) para generar el CLI -- acá hace falta el UUID real
    // del VlanEntity, que vive en "tr069Network.vlanId".
    const tr069Network = await this.tr069Repository.findOneBy({ id: dto.tr069NetworkId });
    config.tr069VlanId = tr069Network?.vlanId;
    await this.configRepository.save(config);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Perfil TR-069 aplicado a ONU ${onu.serialNumber}.${result.warning ? ` Aviso: ${result.warning}` : ''}`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, operation: 'applyTr069Profile' },
    });

    const saved = await this.findById(onu.id);
    return { ...saved, tr069Warning: result.warning };
  }

  /**
   * Acción aislada: cambia SOLO el ACS al que apunta la ONU, sin re-cablear
   * el resto del canal de gestión TR-069 (eso lo hace `applyTr069Profile`,
   * que asume que ya corrió aquí antes). A diferencia de `applyTr069Profile`
   * -- que reporta un rechazo de la OLT como `warning` porque el resto del
   * cableado igual se aplicó -- aquí un rechazo es SIEMPRE un error duro: es
   * la única pieza que esta acción toca, no hay "igual se aplicó algo" que
   * justifique ocultarlo. Pensada para reintentar/cambiar solo el puntero del
   * ACS sin el riesgo de un "éxito" que en realidad no cambió nada.
   */
  async updateTr069AcsUrl(id: string, dto: { tr069NetworkId: string }, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    if (!driver.updateTr069AcsUrl) {
      throw new BadRequestException(
        `[${olt.vendor}] esta operación (actualizar solo el ACS) todavía no está implementada para este fabricante.`,
      );
    }

    // A diferencia de "Aplicar Perfil TR-069" (applyTr069Profile), esta acción
    // NUNCA toca VLAN/tcont/gemport/service-port -- el driver solo entra a
    // "pon-onu-mng" y corre "tr069-mgmt 1 acs" + reboot (ver
    // ZteC320Driver.updateTr069AcsUrl, confirmado leyendo su implementación
    // real). serviceVlanId/speedProfileId/operationMode de `config` ni
    // siquiera llegan al payload final del driver. Por eso, si la ONU no
    // tiene fila de servicio todavía (típico de equipos detectedBy=
    // OLT_IMPORT: producción real, ya cableados en la OLT por fuera de este
    // sistema -- NO hay que re-autorizarlos), se crea una fila mínima acá en
    // vez de bloquear: no hay ningún dato de VLAN/perfil que adivinar para
    // esta operación puntual.
    let config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      config = this.configRepository.create({
        onuId: onu.id,
        managementMethod: 'TR069',
        operationMode: 'ROUTER',
      });
    }
    if (!dto.tr069NetworkId) {
      throw new BadRequestException('Selecciona una Red TR-069.');
    }

    const authParams = await this.buildAuthorizeParams(onu, {
      onuTypeId: onu.onuTypeId,
      serviceVlanId: config.serviceVlanId,
      speedProfileId: config.speedProfileId,
      tr069NetworkId: dto.tr069NetworkId,
      managementMethod: 'TR069',
      operationMode: config.operationMode,
    });

    if (!authParams.tr069Url) {
      throw new BadRequestException(
        `La Red TR-069 seleccionada no tiene una URL de ACS configurada (acsUrl vacío). Corrígela en "Redes TR-069" antes de aplicar el cambio.`,
      );
    }

    const result = await this.callDriver(() =>
      driver.updateTr069AcsUrl!(connParams, {
        ponInterface: authParams.ponInterface,
        onuId: authParams.onuId,
        tr069Url: authParams.tr069Url!,
        tr069AcsUsername: authParams.tr069AcsUsername,
        tr069AcsPassword: authParams.tr069AcsPassword,
      }),
    );
    if (!result.ok) {
      throw new BadRequestException(`La OLT rechazó el cambio de ACS: ${result.error}`);
    }

    config.tr069NetworkId = dto.tr069NetworkId;
    await this.configRepository.save(config);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ACS actualizado para ONU ${onu.serialNumber}.${result.warning ? ` Aviso: ${result.warning}` : ''}`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, operation: 'updateTr069AcsUrl' },
    });

    const saved = await this.findById(onu.id);
    return { ...saved, tr069Warning: result.warning };
  }

  /**
   * Etapa 3 del flujo de 3 etapas: empuja WAN/PPPoE/WiFi + tags reales al
   * CPE vía GenieACS (`pushCpeConfiguration`, sin cambios) -- exige que la
   * Etapa 2 (`applyTr069Profile`) ya se haya aplicado. Expuesta como acción
   * explícita y reintentable desde la Ficha 360, en vez de dispararse
   * automáticamente dentro de `authorizeOnu`/`reprovisionOnu`.
   */
  async pushWanConfig(
    id: string,
    dto: {
      wanMode?: 'PPPOE' | 'DHCP' | 'STATIC';
      wanStaticIp?: string;
      wanStaticMask?: string;
      wanStaticGw?: string;
      ipProtocol?: 'IPV4' | 'IPV6' | 'DUAL';
      wanDns1?: string;
      wanDns2?: string;
      wanStaticIpv6?: string;
      wanStaticIpv6PrefixLen?: number;
      wanStaticIpv6Gw?: string;
      wanStaticIpv6Dns1?: string;
      wanStaticIpv6Dns2?: string;
    },
    actorUserId?: string,
  ) {
    const onu = await this.findById(id);
    const olt = onu.olt;

    const config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config || config.managementMethod !== 'TR069' || !config.tr069NetworkId) {
      throw new BadRequestException(
        'Aplica primero el Perfil TR-069 a esta ONU antes de enviar la configuración WAN/PPPoE.',
      );
    }

    if (dto.wanMode) config.wanMode = dto.wanMode;
    if (dto.ipProtocol) config.ipProtocol = dto.ipProtocol;
    config.wanDns1 = dto.wanDns1 || undefined;
    config.wanDns2 = dto.wanDns2 || undefined;
    config.wanStaticIpv6 = dto.wanStaticIpv6 || undefined;
    config.wanStaticIpv6PrefixLen = dto.wanStaticIpv6PrefixLen ? Number(dto.wanStaticIpv6PrefixLen) : undefined;
    config.wanStaticIpv6Gw = dto.wanStaticIpv6Gw || undefined;
    config.wanStaticIpv6Dns1 = dto.wanStaticIpv6Dns1 || undefined;
    config.wanStaticIpv6Dns2 = dto.wanStaticIpv6Dns2 || undefined;
    await this.configRepository.save(config);

    const { cpeConfigured, cpeConfigWarning } = await this.pushCpeConfiguration(
      onu,
      config,
      olt,
      {
        wanStaticIp: dto.wanStaticIp,
        wanStaticMask: dto.wanStaticMask,
        wanStaticGw: dto.wanStaticGw,
        wanStaticIpv6: dto.wanStaticIpv6,
        wanStaticIpv6PrefixLen: dto.wanStaticIpv6PrefixLen ? Number(dto.wanStaticIpv6PrefixLen) : undefined,
        wanStaticIpv6Gw: dto.wanStaticIpv6Gw,
        wanStaticIpv6Dns1: dto.wanStaticIpv6Dns1,
        wanStaticIpv6Dns2: dto.wanStaticIpv6Dns2,
      },
      {
        warningPrefix: 'No se pudo confirmar la configuración WAN/PPPoE vía GenieACS',
        failureLogMessagePrefix: `[${olt.vendor}] ONU ${onu.serialNumber}: fallo enviando WAN/PPPoE vía GenieACS`,
        operation: 'pushWanConfig',
        actorUserId,
      },
    );

    const saved = await this.findById(onu.id);
    return { ...saved, cpeConfigured, cpeConfigWarning };
  }

  /**
   * Reconfigura el método de gestión / modo de operación / VLANs de gestión
   * de una ONU YA autorizada, y reintenta el push a GenieACS -- SIN volver a
   * disparar el comando CLI de autorización en la OLT. VLAN de servicio y
   * perfil de velocidad son parámetros que sí viven en la OLT física: no se
   * tocan aquí, cambiarlos requiere re-autorizar (authorizeOnu). Pensado
   * para el caso "quiero cambiar de TR-069 a OMCI" o "reintentar el push a
   * GenieACS" sin repetir toda la operación de autorización.
   *
   * NOTA: el flujo de 3 etapas (`applyTr069Profile` + `pushWanConfig`) es
   * ahora el camino recomendado desde la UI (Ficha 360) -- este método se
   * deja intacto por compatibilidad, sin wiring nuevo desde el frontend.
   */
  async reprovisionOnu(id: string, dto: any, actorUserId?: string) {
    const onu = await this.findById(id);
    if (onu.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Solo se puede reconfigurar el aprovisionamiento de una ONU que ya esté autorizada (ACTIVE). Usa "Autorizar y Aprovisionar" primero.',
      );
    }
    const olt = onu.olt;

    let config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      throw new BadRequestException(
        'Esta ONU no tiene configuración de servicio previa -- usa "Autorizar y Aprovisionar" primero.',
      );
    }

    config.mgmtVlanId = dto.mgmtVlanId || undefined;
    config.tr069VlanId = dto.tr069VlanId || undefined;
    config.tr069NetworkId = dto.tr069NetworkId || undefined;
    config.managementMethod = dto.managementMethod || config.managementMethod;
    config.operationMode = dto.operationMode || config.operationMode;
    config.wanMode = dto.wanMode || config.wanMode;
    config.appliedVersion += 1;
    config.desiredVersion = config.appliedVersion;
    config.applyStatus = 'APPLIED';
    await this.configRepository.save(config);

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Reconfiguración de aprovisionamiento aplicada para ONU ${onu.serialNumber} (sin re-autorizar en la OLT).`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, vendor: olt.vendor, operation: 'reprovisionOnu' },
    });

    // Reintentar push a GenieACS con los parámetros (posiblemente nuevos) de
    // gestión. Mismo manejo best-effort que en authorizeOnu paso 4: nunca
    // debe hacer fallar la reconfiguración ya guardada en BD.
    const { cpeConfigured, cpeConfigWarning } = await this.pushCpeConfiguration(
      onu,
      config,
      olt,
      { wanStaticIp: dto.wanStaticIp, wanStaticMask: dto.wanStaticMask, wanStaticGw: dto.wanStaticGw },
      {
        warningPrefix: 'Configuración guardada, pero no se pudo aplicar vía GenieACS',
        failureLogMessagePrefix: `[${olt.vendor}] Reconfiguración de ONU ${onu.serialNumber} guardada pero no se pudo aplicar vía GenieACS`,
        operation: 'reprovisionOnu.configureCpe',
        actorUserId,
      },
    );

    const saved = await this.findById(onu.id);
    return { ...saved, cpeConfigured, cpeConfigWarning };
  }

  /**
   * Bloquea el tráfico óptico de la ONU (RF-OLT-017).
   */
  async blockOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const connParams = await this.connectionResolver.resolve(onu.olt);

    const target = this.buildOnuTarget(onu);
    const result = await driver.setOnuAdminState(connParams, target, 'BLOCKED');
    if (!result.ok) {
      throw new BadRequestException(`No se pudo bloquear la ONU: ${result.error}`);
    }

    onu.status = 'BLOCKED';
    await this.onuRepository.update(onu.id, { status: onu.status });

    await this.deviceOperationLogger.logEvent({
      nodeId: onu.olt.viaNodeId || onu.olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${onu.olt.vendor}] ONU ${onu.serialNumber} bloqueada (shutdown) en ${target}.`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: onu.olt.id, vendor: onu.olt.vendor, driverName: driver.constructor.name, operation: 'blockOnu' },
    });

    return { success: true, status: 'BLOCKED', message: 'ONU bloqueada correctamente en la OLT.' };
  }

  /**
   * Desbloquea / reactiva el tráfico de la ONU (RF-OLT-017).
   */
  async unblockOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const connParams = await this.connectionResolver.resolve(onu.olt);

    const target = this.buildOnuTarget(onu);
    const result = await driver.setOnuAdminState(connParams, target, 'ACTIVE');
    if (!result.ok) {
      throw new BadRequestException(`No se pudo reactivar la ONU: ${result.error}`);
    }

    onu.status = 'ACTIVE';
    await this.onuRepository.update(onu.id, { status: onu.status });

    await this.deviceOperationLogger.logEvent({
      nodeId: onu.olt.viaNodeId || onu.olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${onu.olt.vendor}] ONU ${onu.serialNumber} reactivada (no shutdown) en ${target}.`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: onu.olt.id, vendor: onu.olt.vendor, driverName: driver.constructor.name, operation: 'unblockOnu' },
    });

    return { success: true, status: 'ACTIVE', message: 'ONU reactivada correctamente en la OLT.' };
  }

  /**
   * Elimina el registro de la ONU en la OLT (RF-OLT-017 extendido): libera el
   * onuId para que la ONU física vuelva a aparecer en "Bandeja Sin
   * Configurar" en el próximo escaneo. A diferencia de block/unblock (que
   * solo cortan tráfico), esto es la única forma de revertir una
   * autorización mal hecha (VLAN/TR-069/perfil equivocado) sin dejar el
   * puerto PON ocupado por una config que ya no sirve.
   */
  async deleteOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const ponInterface = onu.ponInterface?.name || 'gpon-olt_1/1/1';
    const parts = onu.onuIndex.split(':');
    const onuId = parts.length > 1 ? parseInt(parts[1], 10) : parseInt(onu.onuIndex, 10) || 1;

    const result = await this.callDriver(() => driver.deleteOnu(connParams, ponInterface, onuId));
    if (!result.ok) {
      throw new BadRequestException(`No se pudo eliminar la ONU en la OLT: ${result.error}`);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ONU ${onu.serialNumber} eliminada de ${ponInterface}:${onuId}. Libre para re-escanear.`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, vendor: olt.vendor, driverName: driver.constructor.name, operation: 'deleteOnu' },
    });

    // onu_service_config tiene onDelete: 'CASCADE' hacia esta fila — no hace
    // falta borrarlo aparte.
    await this.onuRepository.delete({ id: onu.id });

    return {
      success: true,
      message: 'ONU eliminada de la OLT. Ya puede volver a escanearse desde "Bandeja Sin Configurar".',
    };
  }

  /**
   * Migración y reemplazo de hardware de ONU (Benchmark SmartOLT Sección 2).
   * Reemplaza el equipo ONT/ONU (número de serie), re-asigna el puerto PON/NAP
   * y reconfigura la OLT y GenieACS manteniendo intacto el contrato del cliente.
   */
  async migrateOnu(id: string, dto: MigrateOnuDto, actorUserId?: string) {
    const onu = await this.findById(id);

    if (onu.status === 'UNCONFIGURED') {
      throw new BadRequestException('Solo se pueden migrar o reemplazar ONUs que ya estén registradas y autorizadas.');
    }

    const trimmedNewSerial = dto.newSerialNumber.trim();
    if (!trimmedNewSerial) {
      throw new BadRequestException('El nuevo número de serie no puede estar vacío.');
    }

    if (trimmedNewSerial.toUpperCase() === onu.serialNumber.toUpperCase()) {
      throw new BadRequestException('El nuevo número de serie debe ser diferente al actual.');
    }

    // Verificar si el nuevo número de serie ya está en uso en otra ONU
    const duplicate = await this.onuRepository.findOne({
      where: { serialNumber: trimmedNewSerial },
    });
    if (duplicate && duplicate.id !== onu.id) {
      throw new BadRequestException(`El número de serie ${trimmedNewSerial} ya se encuentra registrado en el sistema.`);
    }

    const olt = onu.olt;
    const oldSerial = onu.serialNumber;
    const ponInterface = dto.newPonInterface || onu.ponInterface?.name || 'gpon-olt_1/1/1';
    const parts = onu.onuIndex.split(':');
    const onuId = parts.length > 1 ? parseInt(parts[1], 10) : parseInt(onu.onuIndex, 10) || 1;

    // 1. Intentar desasociar hardware anterior en la OLT física
    let oltDeconfigured = false;
    try {
      const driver = this.resolveDriver(olt);
      const connParams = await this.connectionResolver.resolve(olt);
      const deleteResult = await this.callDriver(() => driver.deleteOnu(connParams, ponInterface, onuId));
      if (deleteResult.ok) {
        oltDeconfigured = true;
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo eliminar ONU anterior ${oldSerial} en OLT ${olt.name} durante migración: ${err.message}`);
    }

    // 2. Gestionar reasignación de puerto NAP si aplica
    if (onu.napPortId && dto.newNapPortId !== undefined && onu.napPortId !== dto.newNapPortId) {
      // Liberar puerto anterior
      await this.napPortRepository.update(onu.napPortId, {
        status: 'DISPONIBLE',
        onuId: null,
      });
      onu.napPortId = null;
    }

    if (dto.newNapPortId) {
      const newPort = await this.napPortRepository.findOne({ where: { id: dto.newNapPortId } });
      if (!newPort) {
        throw new NotFoundException(`Puerto NAP no encontrado: ${dto.newNapPortId}`);
      }
      if (newPort.status === 'OCUPADO' && newPort.onuId && newPort.onuId !== onu.id) {
        throw new BadRequestException(`El puerto NAP #${newPort.portNumber} ya está ocupado por otra ONU.`);
      }
      newPort.status = 'OCUPADO';
      newPort.onuId = onu.id;
      await this.napPortRepository.save(newPort);
      onu.napPortId = newPort.id;
    }

    // 3. Actualizar datos de la ONU en base de datos
    onu.serialNumber = trimmedNewSerial;
    onu.status = 'ACTIVE';
    await this.onuRepository.update(onu.id, {
      serialNumber: onu.serialNumber,
      napPortId: onu.napPortId,
      status: onu.status,
    });

    // 4. Intentar reautorizar el nuevo serial en la OLT con los parámetros existentes
    let oltReauthorized = false;
    let oltWarning = '';
    try {
      const driver = this.resolveDriver(olt);
      const connParams = await this.connectionResolver.resolve(olt);
      const authParams: AuthorizeOnuParams = {
        ponInterface,
        onuId,
        modelTypeName: onu.onuType?.vendorTypeName || onu.onuType?.model || 'ZTE-F660',
        ethPorts: onu.onuType?.ethPorts,
        potsPorts: onu.onuType?.potsPorts,
        serialNumber: onu.serialNumber,
        clientName: onu.contract?.client?.name || undefined,
        serviceVlan: onu.serviceConfig?.serviceVlan?.vlanId || 100,
        tcontProfile: onu.serviceConfig?.speedProfile?.vendorTcontProfile || undefined,
        downKbps: onu.serviceConfig?.speedProfile?.downKbps,
        upKbps: onu.serviceConfig?.speedProfile?.upKbps,
        managementMethod: onu.serviceConfig?.managementMethod || 'TR069',
        operationMode: onu.serviceConfig?.operationMode || 'ROUTER',
        tr069Url: onu.serviceConfig?.tr069Network?.acsUrl,
        tr069Vlan: onu.serviceConfig?.tr069Vlan?.vlanId,
      };
      const authResult = await this.callDriver(() => driver.authorizeOnu(connParams, authParams));
      if (authResult.ok) {
        oltReauthorized = true;
        if (authResult.warning) {
          oltWarning = authResult.warning;
        }
      } else {
        oltWarning = `OLT devolvió error en reautorización: ${authResult.error}`;
      }
    } catch (err: any) {
      this.logger.warn(`Error reautorizando nuevo serial ${trimmedNewSerial} en OLT ${olt.name}: ${err.message}`);
      oltWarning = `No se pudo comunicar con la OLT: ${err.message}`;
    }

    // 5. Configurar GenieACS con el nuevo número de serie para provisión cero-toque
    let cpeConfigured = false;
    try {
      if (onu.serviceConfig?.tr069Network) {
        const tr069Network = onu.serviceConfig.tr069Network;
        let pppoeUsername: string | undefined;
        let pppoePassword: string | undefined;
        if (onu.contractId) {
          const networkAccess = await this.networkAccessRepository.findOneBy({ contractId: onu.contractId });
          if (networkAccess) {
            pppoeUsername = networkAccess.username || undefined;
            pppoePassword = networkAccess.pppoePasswordEnc ? decryptCredential(networkAccess.pppoePasswordEnc) : undefined;
          }
        }

        await this.cpeConfiguratorService.configureCpe({
          serialNumber: onu.serialNumber,
          vendor: onu.onuType?.vendor,
          model: onu.onuType?.model,
          tenantSlug: this.tenantContext.getSlug(),
          operationMode: onu.serviceConfig.operationMode || 'ROUTER',
          wanMode: onu.serviceConfig.wanMode || 'PPPOE',
          pppoeUsername,
          pppoePassword,
          serviceVlan: onu.serviceConfig.serviceVlan?.vlanId || 100,
          managementServer: {
            acsUrl: tr069Network.acsUrl,
            acsUsername: tr069Network.acsUsername || undefined,
            acsPassword: tr069Network.acsPasswordEnc ? decryptCredential(tr069Network.acsPasswordEnc) : undefined,
            connReqUsername: tr069Network.connReqUsername || undefined,
            connReqPassword: tr069Network.connReqPasswordEnc ? decryptCredential(tr069Network.connReqPasswordEnc) : undefined,
            informIntervalSec: tr069Network.informIntervalSec,
          },
        });
        cpeConfigured = true;
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo enviar template GenieACS para nuevo serial ${trimmedNewSerial}: ${err.message}`);
    }

    // 6. Registrar en el log de operaciones
    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Migración/Reemplazo de ONU exitosa: ${oldSerial} -> ${onu.serialNumber}. ` +
        (dto.notes ? `Notas: ${dto.notes}` : ''),
      actorUserId,
      rawDetails: {
        onuId: onu.id,
        oltId: olt.id,
        oldSerial,
        newSerial: onu.serialNumber,
        newNapPortId: dto.newNapPortId,
        oltDeconfigured,
        oltReauthorized,
        cpeConfigured,
        notes: dto.notes,
      },
    });

    const updated = await this.findById(onu.id);
    return {
      success: true,
      message: `ONU reemplazada exitosamente de ${oldSerial} a ${onu.serialNumber}.`,
      onu: updated,
      oltReauthorized,
      oltWarning: oltWarning || undefined,
      cpeConfigured,
    };
  }

  /**
   * Construye el nombre de la sub-interfaz lógica de la ONU (ej.
   * "gpon-onu_1/2/15:1") -- CONFIRMADO CONTRA EL MANUAL OFICIAL (ZXA10 C300
   * Configuration Manual (CLI), §3.1): el puerto físico PON usa el prefijo
   * "gpon-olt_", pero la sub-interfaz de cada ONU autorizada en ese puerto
   * usa el prefijo DISTINTO "gpon-onu_", no el mismo nombre con ":<id>"
   * pegado. Antes de este fix, cuando `onu.onuIndex` era un número suelto
   * (el caso normal tras descubrir una ONU, ver `DiscoveredUncfgOnu`), esto
   * generaba "gpon-olt_X/Y/Z:N" -- bug real confirmado en vivo contra
   * OLT_Tabara_Abajo (2026-10-20) que también rompía bloquear/reactivar ONU
   * (`setOnuAdminState`) y la lectura de potencia óptica
   * (`getOnuOpticalPower`), no solo `authorizeOnu` (ver
   * `ZteC320Driver.toOnuInterfaceName`, que tiene el mismo fix del lado del
   * driver para el script de autorización).
   */
  private buildOnuTarget(onu: OnuEntity): string {
    if (onu.onuIndex.startsWith('gpon-onu_')) {
      return onu.onuIndex;
    }
    const ifaceName = (onu.ponInterface?.name || 'gpon-olt_1/1/1').replace(/^gpon-olt_/, 'gpon-onu_');
    return `${ifaceName}:${onu.onuIndex}`;
  }

  private async buildAuthorizeParams(onu: OnuEntity, dto: any): Promise<AuthorizeOnuParams> {
    const ponInterface = onu.ponInterface?.name || dto.ponInterface || 'gpon-olt_1/1/1';

    // Extraer número de ONU desde onuIndex o usar el asignado
    let onuId = parseInt(dto.onuId, 10);
    if (!onuId) {
      const parts = onu.onuIndex.split(':');
      onuId = parts.length > 1 ? parseInt(parts[1], 10) : parseInt(onu.onuIndex, 10) || 1;
    }

    // Tipo / modelo técnico -- ethPorts/potsPorts viajan también para que el
    // driver pueda auto-crear el "onu-type" en la OLT si todavía no existe
    // ahí (ver ensureOnuTypeProfile en ZteC320Driver).
    let modelTypeName = 'ZTE-F660';
    let onuTypeEthPorts: number | undefined;
    let onuTypePotsPorts: number | undefined;
    if (dto.onuTypeId) {
      const type = await this.onuTypeRepository.findOneBy({ id: dto.onuTypeId });
      if (type) {
        modelTypeName = type.vendorTypeName || type.model;
        onuTypeEthPorts = type.ethPorts;
        onuTypePotsPorts = type.potsPorts;
      }
    }

    // VLAN de servicio
    let serviceVlan = 100;
    if (dto.serviceVlanId) {
      const v = await this.vlanRepository.findOneBy({ id: dto.serviceVlanId });
      if (v) serviceVlan = v.vlanId;
    }

    // TR-069
    let tr069Url: string | undefined;
    let tr069Vlan: number | undefined;
    let tr069AcsUsername: string | undefined;
    let tr069AcsPassword: string | undefined;
    if (dto.tr069NetworkId) {
      const net = await this.tr069Repository.findOne({
        where: { id: dto.tr069NetworkId },
        relations: ['vlan'],
      });
      if (net) {
        tr069Url = net.acsUrl;
        if (net.vlan) tr069Vlan = net.vlan.vlanId;
        tr069AcsUsername = net.acsUsername || undefined;
        tr069AcsPassword = net.acsPasswordEnc ? decryptCredential(net.acsPasswordEnc) : undefined;
      }
    }

    // Perfil de velocidad (TCONT en GPON para subida, Traffic Profile para bajada)
    // Permite pasar tcontProfile y trafficProfile explícitamente desde el modal de autorización
    // (dos dropdowns separados) o resolverlos vía dto.speedProfileId.
    let tcontProfile: string | undefined = dto.tcontProfile || undefined;
    let trafficProfile: string | undefined = dto.trafficProfile || undefined;
    let downKbps: number | undefined;
    let upKbps: number | undefined;

    if (dto.speedProfileId) {
      const profile = await this.speedProfileRepository.findOneBy({ id: dto.speedProfileId });
      if (profile) {
        if (!tcontProfile) tcontProfile = profile.vendorTcontProfile || undefined;
        if (!trafficProfile) {
          trafficProfile =
            profile.vendorTrafficProfile || `TRAFFIC-${Math.round(profile.downKbps / 1024)}M`;
        }
        downKbps = profile.downKbps;
        upKbps = profile.upKbps;
      }
    }

    // Si trafficProfile vino explícito (ej. "TRAFFIC-108M") pero downKbps no está definido, derivar downKbps
    if (trafficProfile && !downKbps) {
      const mbMatch = trafficProfile.match(/TRAFFIC-(\d+)M/i);
      if (mbMatch) {
        downKbps = parseInt(mbMatch[1], 10) * 1024;
      }
    }
    // Si tcontProfile vino explícito pero upKbps no está definido, derivar upKbps
    if (tcontProfile && !upKbps) {
      const mbMatch = tcontProfile.match(/(?:SMARTOLT-|TCONT-)(\d+)M/i);
      if (mbMatch) {
        upKbps = parseInt(mbMatch[1], 10) * 1024;
      }
    }

    return {
      ponInterface,
      onuId,
      modelTypeName,
      ethPorts: onuTypeEthPorts,
      potsPorts: onuTypePotsPorts,
      serialNumber: onu.serialNumber,
      clientName: dto.clientName || undefined,
      // Autogenerada en el frontend (zona de la OLT + GPS del contrato si
      // hay + fecha) y editable antes de autorizar -- el backend confía en
      // el valor que llega, no lo recalcula. Ver
      // docs/onu-tr069-provisioning-zte-c320.md.
      description: dto.description || undefined,
      serviceVlan,
      tcontProfile,
      trafficProfile,
      downKbps,
      upKbps,
      managementMethod: dto.managementMethod || 'TR069',
      operationMode: dto.operationMode || 'ROUTER',
      tr069Url,
      tr069Vlan,
      tr069AcsUsername,
      tr069AcsPassword,
    };
  }
}
