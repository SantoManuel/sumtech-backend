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
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import {
  IOltDriver,
  AuthorizeOnuParams,
  DriverNotImplementedError,
  UnknownOltVendorError,
} from '../ports/olt-driver.port';

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
      relations: ['olt', 'ponInterface'],
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
      const q = `%${dto.search}%`;
      qb.andWhere(
        '(onu.serialNumber ILIKE :q OR onu.mac ILIKE :q OR client.firstName ILIKE :q OR client.lastName ILIKE :q)',
        { q },
      );
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
    const discovered = await this.callDriver(() => driver.getUnconfiguredOnus(connParams));

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

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] Escaneo de ONUs sin configurar en OLT "${olt.name}": ${discovered.length} detectadas.`,
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

    const discovered = await this.callDriver(() => {
      if (!driver.getAuthorizedOnus) {
        throw new DriverNotImplementedError(olt.vendor, 'getAuthorizedOnus');
      }
      return driver.getAuthorizedOnus(connParams, ponInterface);
    });

    const ponIface = await this.ifaceRepository.findOneBy({ oltId: olt.id, name: ponInterface });

    const imported: OnuEntity[] = [];
    for (const item of discovered) {
      const existing = await this.onuRepository.findOneBy({ oltId: olt.id, serialNumber: item.serialNumber });
      if (existing) continue;

      const created = this.onuRepository.create({
        oltId: olt.id,
        ponInterfaceId: ponIface?.id,
        onuIndex: item.onuIndex,
        serialNumber: item.serialNumber,
        vendor: item.vendor,
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

    const onuTarget = onu.onuIndex.startsWith('gpon-onu_')
      ? onu.onuIndex
      : `${onu.ponInterface?.name || 'gpon-olt_1/1/1'}:${onu.onuIndex}`;

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

    // 2. Persistir configuración de servicio en net.onu_service_config
    // Normaliza campos UUID opcionales: un "" (select sin elegir, ej.
    // tr069NetworkId cuando managementMethod=TR069 pero no se eligió red)
    // es un valor inválido para una columna uuid nullable en Postgres
    // ("invalid input syntax for type uuid"), a diferencia de omitir el
    // campo. No confiar solo en que el cliente nunca mande "".
    const mgmtVlanId = dto.mgmtVlanId || undefined;
    const tr069VlanId = dto.tr069VlanId || undefined;
    const tr069NetworkId = dto.tr069NetworkId || undefined;
    const speedProfileId = dto.speedProfileId || undefined;

    let config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      config = this.configRepository.create({
        onuId: onu.id,
        serviceVlanId: dto.serviceVlanId,
        mgmtVlanId,
        tr069VlanId,
        tr069NetworkId,
        managementMethod: dto.managementMethod || 'TR069',
        operationMode: dto.operationMode || 'ROUTER',
        wanMode: dto.wanMode || 'PPPOE',
        speedProfileId,
        desiredVersion: 1,
        appliedVersion: 1,
        applyStatus: 'APPLIED',
      });
    } else {
      config.serviceVlanId = dto.serviceVlanId;
      config.mgmtVlanId = mgmtVlanId;
      config.tr069VlanId = tr069VlanId;
      config.tr069NetworkId = tr069NetworkId;
      config.managementMethod = dto.managementMethod || config.managementMethod;
      config.operationMode = dto.operationMode || config.operationMode;
      config.wanMode = dto.wanMode || config.wanMode;
      config.speedProfileId = speedProfileId;
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

    await this.onuRepository.update(onu.id, {
      status: onu.status,
      authorizedAt: onu.authorizedAt,
      authorizedByUserId: onu.authorizedByUserId,
      contractId: onu.contractId,
      onuTypeId: onu.onuTypeId,
      onuIndex: onu.onuIndex,
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

    // 4. Empujar WiFi/VLAN/WAN reales al CPE vía GenieACS (RF-OLT-013), solo
    // si se eligió gestión TR-069. Esto NUNCA debe hacer fallar la
    // autorización completa: el ONU ya quedó pasando tráfico a nivel OLT en
    // el paso 1 — este es un paso adicional que depende de que el propio
    // ONU ya haya hecho su primer Inform hacia nuestro ACS
    // (ver CpeConfiguratorService.configureCpe -> findDeviceBySerial). Para
    // hardware donde no hay forma verificada de apuntar el ONU al ACS desde
    // la OLT (hoy: HiOSO/EPON), esto normalmente fallará la primera vez —
    // es un estado esperado a comunicar, no un bug que se deba esconder.
    let cpeConfigured: boolean | undefined;
    let cpeConfigWarning: string | undefined;
    if (dto.managementMethod === 'TR069' && dto.tr069NetworkId) {
      try {
        const tr069Network = await this.tr069Repository.findOneBy({ id: dto.tr069NetworkId });
        if (!tr069Network) {
          throw new Error(`Red TR-069 "${dto.tr069NetworkId}" no encontrada.`);
        }
        const onuType = dto.onuTypeId ? await this.onuTypeRepository.findOneBy({ id: dto.onuTypeId }) : null;
        const wanMode = dto.wanMode || 'PPPOE';

        // PPPoE: usuario/contraseña vienen del network_access ya vinculado al
        // contrato (única fuente de verdad, ver Plan_Implementacion_Red_RF.md
        // §8 Fase 8) -- nunca se piden de nuevo en este modal para no terminar
        // con dos credenciales PPPoE distintas (la del secret en RouterOS y la
        // que el propio ONU usa) para el mismo acceso.
        let pppoeUsername: string | undefined;
        let pppoePassword: string | undefined;
        if (wanMode === 'PPPOE' && dto.contractId) {
          const networkAccess = await this.networkAccessRepository.findOneBy({ contractId: dto.contractId });
          if (networkAccess) {
            pppoeUsername = networkAccess.username || undefined;
            pppoePassword = networkAccess.pppoePasswordEnc
              ? decryptCredential(networkAccess.pppoePasswordEnc)
              : undefined;
          }
        }

        await this.cpeConfiguratorService.configureCpe({
          serialNumber: onu.serialNumber,
          vendor: onuType?.vendor,
          model: onuType?.model,
          // Dispara el tag TENANT:<slug> en GenieACS (ver
          // CpeConfiguratorService.configureCpe) — único mecanismo real para
          // saber a qué tenant pertenece un CPE, dado que GenieACS no expone
          // el Host de la conexión TR-069 a su lógica de negocio (un dominio
          // por tenant sería cosmético, no cambia esto).
          tenantSlug: this.tenantContext.getSlug(),
          operationMode: dto.operationMode || 'ROUTER',
          wanMode,
          pppoeUsername,
          pppoePassword,
          wanStaticIp: wanMode === 'STATIC' ? dto.wanStaticIp : undefined,
          wanStaticMask: wanMode === 'STATIC' ? dto.wanStaticMask : undefined,
          wanStaticGw: wanMode === 'STATIC' ? dto.wanStaticGw : undefined,
          serviceVlan: authParams.serviceVlan,
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
        cpeConfigured = true;
      } catch (err: any) {
        cpeConfigured = false;
        cpeConfigWarning = `ONU autorizada en la OLT. Pendiente de aplicar WiFi/VLAN/WAN vía GenieACS: ${err.message}`;
        await this.deviceOperationLogger.logEvent({
          nodeId: olt.viaNodeId || olt.id,
          eventType: 'PROVISION',
          status: 'FAILURE',
          message: `[${olt.vendor}] ONU ${onu.serialNumber} autorizada en la OLT pero no se pudo configurar vía GenieACS: ${err.message}`,
          actorUserId,
          rawDetails: { onuId: onu.id, oltId: olt.id, operation: 'authorizeOnu.configureCpe' },
        });
      }
    }

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
    let cpeConfigured: boolean | undefined;
    let cpeConfigWarning: string | undefined;

    let serviceVlan = 100;
    if (config.serviceVlanId) {
      const v = await this.vlanRepository.findOneBy({ id: config.serviceVlanId });
      if (v) serviceVlan = v.vlanId;
    }

    if (config.managementMethod === 'TR069' && config.tr069NetworkId) {
      try {
        const tr069Network = await this.tr069Repository.findOneBy({ id: config.tr069NetworkId });
        if (!tr069Network) {
          throw new Error(`Red TR-069 "${config.tr069NetworkId}" no encontrada.`);
        }
        const onuType = onu.onuTypeId ? await this.onuTypeRepository.findOneBy({ id: onu.onuTypeId }) : null;
        const wanMode = config.wanMode || 'PPPOE';

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

        await this.cpeConfiguratorService.configureCpe({
          serialNumber: onu.serialNumber,
          vendor: onuType?.vendor,
          model: onuType?.model,
          tenantSlug: this.tenantContext.getSlug(),
          operationMode: config.operationMode || 'ROUTER',
          wanMode,
          pppoeUsername,
          pppoePassword,
          wanStaticIp: wanMode === 'STATIC' ? dto.wanStaticIp : undefined,
          wanStaticMask: wanMode === 'STATIC' ? dto.wanStaticMask : undefined,
          wanStaticGw: wanMode === 'STATIC' ? dto.wanStaticGw : undefined,
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
        cpeConfigured = true;
      } catch (err: any) {
        cpeConfigured = false;
        cpeConfigWarning = `Configuración guardada, pero no se pudo aplicar vía GenieACS: ${err.message}`;
        await this.deviceOperationLogger.logEvent({
          nodeId: olt.viaNodeId || olt.id,
          eventType: 'PROVISION',
          status: 'FAILURE',
          message: `[${olt.vendor}] Reconfiguración de ONU ${onu.serialNumber} guardada pero no se pudo aplicar vía GenieACS: ${err.message}`,
          actorUserId,
          rawDetails: { onuId: onu.id, oltId: olt.id, operation: 'reprovisionOnu.configureCpe' },
        });
      }
    }

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

  private buildOnuTarget(onu: OnuEntity): string {
    if (onu.onuIndex.startsWith('gpon-onu_')) {
      return onu.onuIndex;
    }
    const ifaceName = onu.ponInterface?.name || 'gpon-olt_1/1/1';
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

    // Tipo / modelo técnico
    let modelTypeName = 'ZTE-F660';
    if (dto.onuTypeId) {
      const type = await this.onuTypeRepository.findOneBy({ id: dto.onuTypeId });
      if (type) modelTypeName = type.vendorTypeName || type.model;
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
    if (dto.tr069NetworkId) {
      const net = await this.tr069Repository.findOne({
        where: { id: dto.tr069NetworkId },
        relations: ['vlan'],
      });
      if (net) {
        tr069Url = net.acsUrl;
        if (net.vlan) tr069Vlan = net.vlan.vlanId;
      }
    }

    // Perfil de velocidad (TCONT en GPON, kbps crudos para drivers que lo
    // necesiten así, ej. EPON) — antes de este fix nunca se leía
    // dto.speedProfileId, así que ningún fabricante recibía el perfil que el
    // usuario elegía en el modal (ZTE siempre caía en su default hardcodeado).
    let tcontProfile: string | undefined;
    let downKbps: number | undefined;
    let upKbps: number | undefined;
    if (dto.speedProfileId) {
      const profile = await this.speedProfileRepository.findOneBy({ id: dto.speedProfileId });
      if (profile) {
        tcontProfile = profile.vendorTcontProfile || undefined;
        downKbps = profile.downKbps;
        upKbps = profile.upKbps;
      }
    }

    return {
      ponInterface,
      onuId,
      modelTypeName,
      serialNumber: onu.serialNumber,
      clientName: dto.clientName || undefined,
      serviceVlan,
      tcontProfile,
      downKbps,
      upKbps,
      managementMethod: dto.managementMethod || 'TR069',
      operationMode: dto.operationMode || 'ROUTER',
      tr069Url,
      tr069Vlan,
    };
  }
}
