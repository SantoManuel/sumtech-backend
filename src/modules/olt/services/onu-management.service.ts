import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Tr069Result, initialTr069Result, evidence } from '../ports/tr069-provisioning.types';
import { validateTr069Input } from '../drivers/zte-c320-tr069-state';
import { redactOltCli } from '../utils/redact-olt-cli';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual, Not, In } from 'typeorm';
import { findFirstFreeOnuId } from '../drivers/zte-c320-parsers';
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
import { BatchTr069AcsDto } from '../dto/batch-tr069-acs.dto';
import { NetworkAccessEntity } from '../../network/entities/network-access.entity';
import { NapPortEntity } from '../../network/entities/nap-port.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';

import { resolveCpeIpv6Capabilities } from '../../genieacs/services/cpe-capabilities';
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';
import { GenieAcsWifiService } from '../../genieacs/genieacs-wifi.service';
import { StaffChangeWifiCredentialsDto } from '../../genieacs/dto/staff-change-wifi-credentials.dto';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import {
  IOltDriver,
  AuthorizeOnuParams,
  DriverNotImplementedError,
  UnknownOltVendorError,
  OnuDetailInfo,
  OnuIpHostInfo,
  OnuWanIpInfo,
  OnuTr069MgmtInfo,
  BatchTr069AcsItemInput,
  BatchTr069AcsItemOutput,
  BatchTr069AcsResult,
} from '../ports/olt-driver.port';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';
import { OltPartialOperationService } from './olt-partial-operation.service';
import { OnuWanProvisioningService } from './onu-wan-provisioning.service';
import { ConfigureOnuWanDto } from '../dto/configure-onu-wan.dto';
import { OnuOmciWanProfileDto } from '../dto/onu-omci-wan-profile.dto';

export interface ProvisioningAuditFinding {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  message: string;
  command?: string;
  rawExcerpt?: string;
  fixAction?: 'REAPPLY_TR069' | 'REAUTHORIZE' | 'APPLY_WAN_IP' | 'APPLY_SERVICE_GEMPORT';
}

export interface ProvisioningAuditResult {
  findings: ProvisioningAuditFinding[];
  detailInfo?: OnuDetailInfo;
  ipHost?: OnuIpHostInfo;
  wanIp?: OnuWanIpInfo;
  tr069Mgmt?: OnuTr069MgmtInfo;
  macTable?: Array<{ mac: string; vlan: number }>;
  /** Nombres de los métodos del driver que no están implementados para este fabricante (ej. HiOSO) -- el frontend debe mostrar "no disponible para este fabricante" en vez de un error. */
  unsupported: string[];
}

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

    private readonly genieAcsDeviceResolver: GenieAcsDeviceResolverService,
    private readonly genieAcsWifiService: GenieAcsWifiService,
    private readonly tenantContext: TenantContextService,
    private readonly partialOperations: OltPartialOperationService,
    private readonly wanProvisioning: OnuWanProvisioningService,
  ) {}

  private async recordPartialOperation(oltId: string, onuId: string, operation: string) {
    try {
      await this.partialOperations.record({ oltId, onuId, operation, resourceKey: onuId, expectedState: 'PRESENT' });
    } catch {
      this.logger.error(`No se pudo registrar la operación parcial ${operation} para ONU ${onuId} en OLT ${oltId}.`);
    }
  }

  
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
      // Alias en minúsculas a propósito (no "ponInterface"/"onuType"): dentro de un
      // .andWhere() crudo, TypeORM solo re-escapa alias.propiedad para alias que ya
      // son válidos sin comillas -- un alias con mayúsculas intercaladas llega a
      // Postgres sin comillas, que lo pasa a minúsculas ("onutype") y ya no
      // coincide con el alias real (con mayúscula preservada) del FROM/JOIN,
      // reventando con "missing FROM-clause entry" (bug real confirmado en
      // producción contra OLTs ZTE C320, 2026-10-28). Mismo motivo por el que
      // "onu"/"client"/"contract"/"olt" sí funcionaban: ya eran minúsculas.
      .leftJoinAndSelect('onu.ponInterface', 'poninterface')
      .leftJoinAndSelect('onu.onuType', 'onutype')
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
        // (ponInterface.name), OLT (olt.name) y modelo (onuType.model -- OnuTypeEntity
        // nunca tuvo una propiedad "modelName", solo "model"; TypeORM no traduce un
        // alias.propiedad inexistente, lo deja literal y Postgres revienta con
        // "column onutype.modelname does not exist" -- bug real, independiente del
        // de los alias con mayúsculas, confirmado en producción 2026-10-28).
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
            OR poninterface.name ILIKE :q
            OR olt.name ILIKE :q
            OR onutype.model ILIKE :q
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

    (onu as any).wanCapabilities = this.wanProvisioning.capabilities(onu);
    (onu as any).wanOperation = await this.wanProvisioning.latestOperation(onu.id);
    const cpeCaps = resolveCpeIpv6Capabilities(onu.vendor, onu.onuType?.model);
    (onu as any).cpeIpv6Capabilities = cpeCaps.capabilities;
    (onu as any).cpeIpv6CapabilityNotes = cpeCaps.notes;

    // Resolución de dispositivo GenieACS:
    // 1. Si la ONU tiene contrato vinculado, consultar por contractId en net.genieacs_devices
    if (onu.contract?.id) {
      const genieAcsDevice = await this.genieAcsDeviceResolver.findByContractId(onu.contract.id);
      if (genieAcsDevice?.genieacsDeviceId) {
        onu.genieacsDeviceId = genieAcsDevice.genieacsDeviceId;
      }
    }

    // 2. Si no tiene contrato (ej. brownfield/en despliegue) o la tabla de contratos aún no lo tiene,
    // buscar directamente en GenieACS por el número de serie de la ONU física.
    if (!onu.genieacsDeviceId && onu.serialNumber) {
      const directDeviceId = await this.genieAcsDeviceResolver.resolveBySerialNumber(onu.serialNumber);
      if (directDeviceId) {
        onu.genieacsDeviceId = directDeviceId;
        await this.onuRepository.update(onu.id, { genieacsDeviceId: directDeviceId });
      }
    }

    // 3. Telemetría viva y auto-reconciliación de tags y confirmación en GenieACS:
    if (onu.genieacsDeviceId) {
      try {
        const liveStatus = await this.genieAcsDeviceResolver.getDeviceStatus?.(onu.genieacsDeviceId);
        if (liveStatus) {
          const tenantSlug = this.tenantContext.getSlug()?.toLowerCase().trim();
          const expectedTags: string[] = [];
          if (tenantSlug) expectedTags.push(`TENANT:${tenantSlug}`);
          if (onu.olt?.name) expectedTags.push(`OLT:${onu.olt.name}`);

          const missing = expectedTags.filter((t) => !liveStatus.tags?.includes(t));
          if (missing.length > 0) {
            await this.genieAcsDeviceResolver.ensureDeviceTags?.(onu.genieacsDeviceId, missing);
            liveStatus.tags = [...(liveStatus.tags || []), ...missing];
          }

          const isOnline = liveStatus.lastInformAt
            ? Date.now() - new Date(liveStatus.lastInformAt).getTime() < 300000
            : false;

          (onu as any).genieacsDeviceStatus = {
            deviceId: liveStatus.deviceId,
            isOnline,
            lastInformAt: liveStatus.lastInformAt,
            registeredAt: liveStatus.registeredAt,
            ip: liveStatus.ip,
            manufacturer: liveStatus.manufacturer,
            serialNumber: liveStatus.serialNumber,
            tags: liveStatus.tags,
            ssid: liveStatus.ssid,
            ssid5g: liveStatus.ssid5g,
          };

          if (onu.serviceConfig && onu.serviceConfig.cpeConfigStatus !== 'APPLIED') {
            const hasTags = expectedTags.length === 0 || expectedTags.every((t) => liveStatus.tags?.includes(t));
            if (liveStatus.lastInformAt && hasTags) {
              onu.serviceConfig.cpeConfigStatus = 'APPLIED';
              onu.serviceConfig.cpeConfigSyncedAt = new Date();
              onu.serviceConfig.lastCpeConfigError = null;
              await this.configRepository.save(onu.serviceConfig);
            }
          }
        }
      } catch (err: any) {
        this.logger.warn(`No se pudo consultar estado vivo de GenieACS para ONU ${onu.id}: ${err?.message}`);
      }
    }

    return onu;
  }

  /**
   * Escanea ONUs no configuradas en una OLT (RF-OLT-014).
   */
  /**
   * Consulta el próximo ID de ONU disponible (1..128) para un puerto PON dado,
   * consultando la OLT en vivo o recurriendo a la base de datos local si no está accesible.
   */
  async getAvailableOnuId(id: string): Promise<{ nextFreeOnuId: number; occupiedIds: number[]; ponInterface: string }> {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    let ponInterface = onu.ponInterface?.name;
    if (!ponInterface && onu.onuIndex?.startsWith('gpon-onu_')) {
      const match = onu.onuIndex.match(/^gpon-onu_(\d+\/\d+\/\d+)/);
      if (match) ponInterface = `gpon-olt_${match[1]}`;
    }
    if (!ponInterface) {
      throw new BadRequestException('No se pudo determinar el puerto PON de la ONU.');
    }

    try {
      const connParams = await this.connectionResolver.resolve(olt);
      if (driver.getAvailableOnuId) {
        const live = await withOltTelnetLock(olt.id, () => driver.getAvailableOnuId!(connParams, ponInterface!));
        return { ...live, ponInterface };
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo consultar el slot libre en vivo en la OLT: ${err.message}. Calculando desde la base de datos.`);
    }

    const ponIface = await this.ifaceRepository.findOneBy({ oltId: olt.id, name: ponInterface });
    const activeOnus = await this.onuRepository.find({
      where: {
        oltId: olt.id,
        ...(ponIface ? { ponInterfaceId: ponIface.id } : {}),
        status: Not('UNCONFIGURED' as any),
      },
      select: ['onuIndex'],
    });

    const occupied = new Set<number>();
    for (const o of activeOnus) {
      const m = String(o.onuIndex).match(/:(\d+)$/);
      if (m) {
        const num = parseInt(m[1], 10);
        if (Number.isInteger(num)) occupied.add(num);
      }
    }

    const nextFree = findFirstFreeOnuId(occupied) || 1;
    return {
      nextFreeOnuId: nextFree,
      occupiedIds: Array.from(occupied).sort((a, b) => a - b),
      ponInterface,
    };
  }

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
   * Consulta la configuración activa ("show running-config interface <iface>")
   * directamente en la OLT para extraer name, description, metadatos (zona, GPS),
   * TCONTs, Gemports y Service-ports (útil para identificar a qué cliente pertenece
   * una ONU activa sin contrato y auditar sus perfiles).
   */
  async getOnuRunningConfig(id: string) {
    const onu = await this.findById(id);
    if (!onu.olt) {
      throw new NotFoundException(`La ONU ${id} no tiene una OLT asociada.`);
    }

    if (!onu.onuIndex || onu.status === 'UNCONFIGURED') {
      throw new BadRequestException('Esta ONU no está configurada o autorizada en la OLT.');
    }

    const driver = this.resolveDriver(onu.olt);
    if (!driver.getOnuRunningConfig) {
      throw new DriverNotImplementedError(onu.olt.vendor, 'getOnuRunningConfig');
    }

    const connParams = await this.connectionResolver.resolve(onu.olt);
    const onuTarget = this.buildOnuTarget(onu);

    const result = await withOltTelnetLock(onu.olt.id, () =>
      driver.getOnuRunningConfig!(connParams, onuTarget),
    );

    if ((result.name && result.name !== onu.name) || (result.description && result.description !== onu.description)) {
      await this.onuRepository.update(onu.id, {
        name: result.name || onu.name,
        description: result.description || onu.description,
      });
      onu.name = result.name || onu.name;
      onu.description = result.description || onu.description;
    }

    return {
      onuId: onu.id,
      serialNumber: onu.serialNumber,
      onuInterface: onuTarget,
      oltName: onu.olt.name,
      ...result,
    };
  }

  /**
   * Actualiza los datos administrativos (name y/o description) de la ONU
   * directamente en la sub-interfaz de la OLT y sincroniza la base de datos (net.onus).
   */
  async updateOnuOltInfo(id: string, dto: { name?: string; description?: string }, actorUserId?: string) {
    const onu = await this.findById(id);
    if (!onu.olt) {
      throw new NotFoundException(`La ONU ${id} no tiene una OLT asociada.`);
    }

    if (!onu.onuIndex || onu.status === 'UNCONFIGURED') {
      throw new BadRequestException('Esta ONU no está configurada o autorizada en la OLT.');
    }

    const driver = this.resolveDriver(onu.olt);
    if (!driver.updateOnuOltInfo) {
      throw new DriverNotImplementedError(onu.olt.vendor, 'updateOnuOltInfo');
    }

    const connParams = await this.connectionResolver.resolve(onu.olt);
    const onuTarget = this.buildOnuTarget(onu);

    const result = await withOltTelnetLock(onu.olt.id, () =>
      driver.updateOnuOltInfo!(connParams, onuTarget, dto),
    );

    if (!result.ok) {
      throw new BadRequestException(`No se pudo actualizar la ONU en la OLT: ${result.error}`);
    }

    // Persistir en base de datos
    const updateData: { name?: string; description?: string } = {};
    if (dto.name !== undefined) {
      updateData.name = dto.name.trim();
    }
    if (dto.description !== undefined) {
      updateData.description = dto.description.trim();
    }

    if (Object.keys(updateData).length > 0) {
      await this.onuRepository.update(onu.id, updateData);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: onu.olt.viaNodeId || onu.olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${onu.olt.vendor}] ONU ${onu.serialNumber} datos OLT actualizados en ${onuTarget}: name="${dto.name ?? ''}", description="${dto.description ?? ''}"`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: onu.olt.id, onuTarget, ...dto },
    });

    return await this.getOnuRunningConfig(onu.id);
  }

  /**
   * Auditoría de aprovisionamiento (pestaña "Auditoría" de la Ficha 360 de
   * la ONU) -- corre en vivo contra la OLT los mismos comandos `show` que
   * hasta ahora se interpretaban a mano (pegados en texto) cuando una ONU
   * no obtenía IP, y aplica un motor de reglas simple con los patrones de
   * falla ya identificados en producción: Config state distinto de
   * "success", el tipo de ONU que la OLT reporta no coincide con el que
   * Sumtech cree tener autorizado, la IP de gestión (WAN host 2) en
   * 0.0.0.0, el ACS aplicado distinto al configurado, o VLANs sin ninguna
   * MAC aprendida. Ver Plan_Implementacion_Auditoria_Aprovisionamiento_ONU.md.
   *
   * Las consultas se serializan por OLT y conservan resultados independientes -- un
   * driver que no implemente alguno de estos métodos opcionales (ej.
   * HiOSO) no debe tumbar las otras 3, solo reportarse en `unsupported`.
   */
  async getProvisioningAudit(id: string): Promise<ProvisioningAuditResult> {
    const { onu, driver, connParams, ponInterface, onuId } = await this.resolveOnuAuditTarget(id);

    const NOT_SUPPORTED = 'NOT_SUPPORTED';
    const [detailInfoResult, ipHostResult, wanIpResult, tr069MgmtResult, macTableResult] = await withOltTelnetLock(onu.olt.id, async () => {
      const settle = async <T>(fn: () => Promise<T>): Promise<PromiseSettledResult<T>> => {
        try { return { status: 'fulfilled', value: await fn() }; }
        catch (reason) { return { status: 'rejected', reason }; }
      };
      return [
        await settle(() => driver.getOnuDetailInfo ? driver.getOnuDetailInfo(connParams, ponInterface, onuId) : Promise.reject(new Error(NOT_SUPPORTED))),
        await settle(() => driver.getOnuIpHost ? driver.getOnuIpHost(connParams, ponInterface, onuId) : Promise.reject(new Error(NOT_SUPPORTED))),
        await settle(() => driver.getOnuWanIp ? driver.getOnuWanIp(connParams, ponInterface, onuId) : Promise.reject(new Error(NOT_SUPPORTED))),
        await settle(() => driver.getOnuTr069MgmtInfo ? driver.getOnuTr069MgmtInfo(connParams, ponInterface, onuId) : Promise.reject(new Error(NOT_SUPPORTED))),
        await settle(() => driver.getOnuMacTable ? driver.getOnuMacTable(connParams, ponInterface, onuId) : Promise.reject(new Error(NOT_SUPPORTED))),
      ] as const;
    });

    const detailInfo = detailInfoResult.status === 'fulfilled' ? detailInfoResult.value : undefined;
    const ipHost = ipHostResult.status === 'fulfilled' ? ipHostResult.value : undefined;
    const wanIp = wanIpResult.status === 'fulfilled' ? wanIpResult.value : undefined;
    const tr069Mgmt = tr069MgmtResult.status === 'fulfilled' ? tr069MgmtResult.value : undefined;
    const macTable = macTableResult.status === 'fulfilled' ? macTableResult.value : undefined;

    const findings: ProvisioningAuditFinding[] = [];
    const unsupported: string[] = [];

    const namedResults: Array<[string, PromiseSettledResult<unknown>]> = [
      ['getOnuDetailInfo', detailInfoResult],
      ['getOnuIpHost', ipHostResult],
      ['getOnuWanIp', wanIpResult],
      ['getOnuTr069MgmtInfo', tr069MgmtResult],
      ['getOnuMacTable', macTableResult],
    ];
    for (const [label, result] of namedResults) {
      if (result.status === 'rejected') {
        const message = result.reason?.message || String(result.reason);
        if (message === NOT_SUPPORTED) {
          unsupported.push(label);
        } else {
          findings.push({ severity: 'WARNING', message: `No se pudo obtener "${label}": ${message}` });
        }
      }
    }

    if (detailInfo) {
      // CONFIRMADO EN VIVO (2026-10-29, ONU ECOM0F91DF9B): con "Phase state:
      // LOS" ningún host (ni servicio ni gestión) obtiene IP, porque OMCI/
      // VEIP ni siquiera puede aplicarse sin señal óptica -- capa física, no
      // cableado OMCI/TR-069. Se reporta PRIMERO y SIN fixAction (ni
      // "Reaplicar TR-069" ni "Reautorizar" resuelven un problema óptico) para
      // no mandar al operador a reintentar aprovisionamiento sobre un equipo
      // que ni siquiera está en línea.
      if (detailInfo.phaseState && detailInfo.phaseState.toLowerCase() !== 'working') {
        findings.push({
          severity: 'CRITICAL',
          message:
            `La OLT reporta "Phase state: ${detailInfo.phaseState}" -- esto es pérdida de señal óptica ` +
            '(capa física GPON), no un problema de cableado OMCI/TR-069. Ningún canal (servicio ni gestión) ' +
            'puede obtener IP mientras la ONU esté en este estado. Revisa la fibra, el conector, el splitter y ' +
            'la potencia óptica (pestaña "Resumen" de esta ONU) antes de reintentar cualquier aprovisionamiento.',
          command: 'show gpon onu detail-info',
          rawExcerpt: detailInfo.raw,
        });
      }

      if (detailInfo.configState && detailInfo.configState.toLowerCase() !== 'success') {
        findings.push({
          severity: 'CRITICAL',
          message:
            `El "Config state" del ONT está en "${detailInfo.configState}" (no "success"). El canal de gestión ` +
            'OMCI no se aplicó limpio. Reintenta la Etapa 2 ("Aplicar perfil TR-069"); si el equipo ya tiene ' +
            'varios reintentos fallidos encima, reautoriza desde la Etapa 1 completa (fuerza "no onu" + recreación limpia).',
          command: 'show gpon onu detail-info',
          rawExcerpt: detailInfo.raw,
          fixAction: 'REAPPLY_TR069',
        });
      }

      const expectedType = onu.onuType?.vendorTypeName;
      if (detailInfo.type && expectedType && detailInfo.type !== expectedType) {
        findings.push({
          severity: 'CRITICAL',
          message:
            `La OLT reporta el tipo de ONU "${detailInfo.type}", pero Sumtech tiene registrado "${expectedType}". ` +
            'La última reautorización no se aplicó de verdad en el equipo.',
          command: 'show gpon onu detail-info',
          rawExcerpt: detailInfo.raw,
          fixAction: 'REAUTHORIZE',
        });
      }
    }

    // Usa ip-host, NO wan-ip, como fuente de verdad -- CONFIRMADO EN VIVO
    // (2026-10-29, ONU ECOM0F91DF9B): "show ... wan-ip" devuelve "%Code
    // 64040-GPONRM : No relate information to show" para cualquier ONU
    // aprovisionada por el camino ip-host/dhcp-ip ethuni (el que de verdad
    // usamos hoy) -- NO es evidencia de que la ONU no tenga IP, solo de que
    // no usa el mecanismo "wan-ip" (ver Plan_Implementacion_WanIp_VlanProfile_HGU.md,
    // todavía no implementado). Tratar esa ausencia como "crítico" era un
    // falso positivo.
    if (ipHost && !/Host\s*(?:ID)?\s*:\s*\d+\b/i.test(ipHost.raw)) {
      findings.push({ severity: 'WARNING', message: 'No se pudieron identificar hosts en la respuesta ip-host; revisa la salida antes de reparar.', command: 'show gpon remote-onu ip-host', rawExcerpt: ipHost.raw });
    } else if (ipHost) {
      // Host ID: 1 (canal de servicio/internet) -- iphost 1 se cablea en el
      // script de autorización completo (Etapa 1), NO en el reintento aislado
      // de TR-069 (Etapa 2, que solo toca iphost 2) -- por eso su fixAction
      // es REAUTHORIZE y no REAPPLY_TR069.
      if (/Host\s*(?:ID)?\s*:\s*1\b/i.test(ipHost.raw) && !ipHost.serviceIp) {
        findings.push({
          severity: 'CRITICAL',
          message:
            'La ONU no ha obtenido IP en el canal de SERVICIO/internet por DHCP (Host ID: 1). Esto se cablea en ' +
            'la autorización completa (Etapa 1), no en el reintento de TR-069 -- confirma primero que no esté en ' +
            '"Phase state: LOS" arriba, y si no, reautoriza desde la Etapa 1 completa.',
          command: 'show gpon remote-onu ip-host',
          rawExcerpt: ipHost.raw,
          fixAction: 'REAUTHORIZE',
        });
      }

      if (ipHost.ipHostFound && !ipHost.mgmtIp) {
        findings.push({
          severity: 'CRITICAL',
          message:
            'La ONU no ha obtenido IP de gestión por DHCP (Host ID: 2). Revisa el servidor DHCP de la VLAN de ' +
            'gestión en el MikroTik, o confirma primero que el "Config state" realmente haya quedado en "success".',
          command: 'show gpon remote-onu ip-host',
          rawExcerpt: ipHost.raw,
          fixAction: 'REAPPLY_TR069',
        });
      }

      // Opción A/B de recuperación (CONFIRMADO EN VIVO, 2026-10-30, ONU
      // ECOM0F91DF9B): cuando NINGÚN host tiene IP pese a que el cableado
      // flow/switchport-bind/veip ya existe, ofrece "wan-ip" como primer
      // intento (no destructivo) y, si eso tampoco resuelve, "service
      // <id> gemport <id> vlan <vlan>" como último recurso (destructivo --
      // borra y reconstruye el cableado de ambos canales).
      if (ipHost.ipHostFound && /Host\s*(?:ID)?\s*:\s*1\b/i.test(ipHost.raw) && !ipHost.mgmtIp && !ipHost.serviceIp) {
        findings.push({
          severity: 'CRITICAL',
          message:
            'Ningún canal (servicio ni gestión) ha obtenido IP. Verifica antes el estado óptico y el cableado OMCI. ' +
            'Opción A: re-aplicar "wan-ip" directamente sobre esta ONU, sin tocar el resto del cableado.',
          command: 'wan-ip 1/2 mode dhcp vlan-profile ...',
          fixAction: 'APPLY_WAN_IP',
        });
        findings.push({
          severity: 'WARNING',
          message:
            'Opción B (último recurso, solo si la Opción A no resolvió): borra el cableado flow/switchport-bind/' +
            'veip de AMBOS canales y lo reemplaza por "service <id> gemport <id> vlan <vlan>". Acción destructiva.',
          command: 'service 1/2 gemport 1/2 vlan ...',
          fixAction: 'APPLY_SERVICE_GEMPORT',
        });
      }
    }

    if (tr069Mgmt) {
      const expectedAcs = onu.serviceConfig?.tr069Network?.acsUrl;
      if (expectedAcs && tr069Mgmt.acsUrl && tr069Mgmt.acsUrl !== expectedAcs) {
        findings.push({
          severity: 'WARNING',
          message: `El ACS aplicado en la OLT ("${tr069Mgmt.acsUrl}") no coincide con la Red TR-069 configurada en Sumtech ("${expectedAcs}").`,
          command: 'show gpon remote-onu tr069-mgmt',
          rawExcerpt: tr069Mgmt.raw,
          fixAction: 'REAPPLY_TR069',
        });
      }
    }

    if (macTable) {
      const expectedVlans = [onu.serviceConfig?.serviceVlan?.vlanId, onu.serviceConfig?.tr069Vlan?.vlanId].filter(
        (v): v is number => typeof v === 'number',
      );
      for (const vlan of expectedVlans) {
        if (!macTable.some((m) => m.vlan === vlan)) {
          findings.push({
            severity: 'WARNING',
            message: `No se ha aprendido ninguna dirección MAC en la VLAN ${vlan} todavía.`,
            command: 'show mac gpon onu',
          });
        }
      }
    }

    // Advertencia retroactiva: el modelo tiene una incompatibilidad OMCI
    // conocida (dhcp-ip ethuni / security-mgmt, ver migraciones 103/104) y
    // esta ONU se autorizó antes de que ese fix existiera -- el script que
    // realmente corrió pudo haber incluido el comando problemático.
    const fixDeployedAt = new Date('2026-10-28T22:00:00Z');
    if (
      onu.authorizedAt &&
      new Date(onu.authorizedAt) < fixDeployedAt &&
      (onu.onuType?.supportsEthuniDhcpDelegation === false || onu.onuType?.supportsSecurityMgmt === false)
    ) {
      findings.push({
        severity: 'WARNING',
        message:
          'Este modelo tiene una incompatibilidad OMCI conocida y esta ONU se autorizó antes de corregirla en el ' +
          'sistema. Recomendado: reautorizar desde la Etapa 1 completa.',
      });
    }

    if (findings.length === 0) {
      findings.push({ severity: 'INFO', message: 'No se detectaron discrepancias conocidas en esta auditoría.' });
    }

    return { findings, detailInfo, ipHost, wanIp, tr069Mgmt, macTable, unsupported };
  }

  /** Resuelve driver/connParams/ponInterface/onuId -- mismo criterio que `getProvisioningAudit()`. */
  private async resolveOnuAuditTarget(id: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);
    const { ponInterface, onuId } = this.resolveOnuLocation(onu);
    return { onu, driver, connParams, ponInterface, onuId };
  }

  /**
   * Consulta en vivo a la OLT la IP de gestión/servicio que la ONU YA
   * OBTUVO (vía "show gpon remote-onu ip-host" / "wan-ip") -- esto es lo que
   * permite abrir la GUI web remota (ver OnuWebProxyService) sin depender de
   * que la ONU haya contactado a GenieACS. Solo ZTE tiene estas consultas
   * implementadas de verdad hoy (CONFIRMADO EN VIVO, ver
   * zte-c320-onu-audit.ts); cualquier otro fabricante, o cualquier error de
   * conexión/driver, hace que esto devuelva null en vez de reventar -- es un
   * mejor-esfuerzo, no una operación crítica.
   */
  async resolveLiveManagementIp(id: string): Promise<string | null> {
    let target: Awaited<ReturnType<typeof this.resolveOnuAuditTarget>>;
    try {
      target = await this.resolveOnuAuditTarget(id);
    } catch {
      return null;
    }
    const { onu, driver, connParams, ponInterface, onuId } = target;

    try {
      return await withOltTelnetLock(onu.olt.id, async () => {
        if (driver.getOnuIpHost) {
          try {
            const ipHost = await driver.getOnuIpHost(connParams, ponInterface, onuId);
            if (ipHost.mgmtIp && ipHost.mgmtIp !== '0.0.0.0') return ipHost.mgmtIp;
            if (ipHost.serviceIp && ipHost.serviceIp !== '0.0.0.0') return ipHost.serviceIp;
          } catch {
            // seguir intentando con wan-ip
          }
        }
        if (driver.getOnuWanIp) {
          try {
            const wanIp = await driver.getOnuWanIp(connParams, ponInterface, onuId);
            const ip = wanIp.host2?.ip || wanIp.host1?.ip;
            if (ip && ip !== '0.0.0.0') return ip;
          } catch {
            // sin suerte, ningún dato real disponible
          }
        }
        return null;
      });
    } catch (err: any) {
      this.logger.warn(`No se pudo consultar la IP en vivo en la OLT para ONU ${id}: ${err.message}`);
      return null;
    }
  }

  /**
   * Opción A de recuperación de IP ("Reaplicar wan-ip") -- acción deliberada
   * disparada desde la pestaña de Auditoría, CONFIRMADA EN VIVO (2026-10-30,
   * OLT_Tabara_Abajo, ONU ECOM0F91DF9B). NO toca el resto del cableado OMCI.
   */
  async applyWanIpFix(id: string) {
    return this.wanProvisioning.withMutation(id, () => this.performApplyWanIpFix(id));
  }

  private async performApplyWanIpFix(id: string) {
    await this.wanProvisioning.assertLegacyWanRecovery(id);
    const { onu, driver, connParams, ponInterface, onuId } = await this.resolveOnuAuditTarget(id);
    if (typeof driver.applyWanIpFix !== 'function') {
      throw new BadRequestException('Este fabricante de OLT todavía no soporta esta corrección.');
    }

    const serviceVlan = onu.serviceConfig?.serviceVlan?.vlanId;
    if (!serviceVlan) {
      throw new BadRequestException('Esta ONU no tiene una VLAN de servicio configurada -- no se puede aplicar wan-ip.');
    }

    const result = await withOltTelnetLock(onu.olt.id, () => driver.applyWanIpFix!(connParams, ponInterface, onuId, {
      serviceVlan,
      tr069Vlan: onu.serviceConfig?.tr069Vlan?.vlanId,
    }));
    if (!result.ok) {
      throw new BadRequestException(`La OLT rechazó la corrección: ${result.error}`);
    }
    return { success: true, message: 'Configuración "wan-ip" re-aplicada en la OLT.' };
  }

  /**
   * Opción B ("último recurso") de recuperación de IP -- DESTRUCTIVA, borra
   * el cableado flow/switchport-bind/veip de ambos canales y lo reemplaza
   * por "service <id> gemport <id> vlan <vlan>". CONFIRMADA EN VIVO
   * (2026-10-30, OLT_Tabara_Abajo, ONU ECOM0F91DF9B). Solo debe dispararse
   * después de intentar `applyWanIpFix`.
   */
  async applyServiceGemportFix(id: string) {
    return this.wanProvisioning.withMutation(id, () => this.performApplyServiceGemportFix(id));
  }

    private async performApplyServiceGemportFix(id: string) {
    const { onu, driver, connParams, ponInterface, onuId } = await this.resolveOnuAuditTarget(id);
    if (typeof driver.applyServiceGemportFix !== 'function') {
      throw new BadRequestException('Este fabricante de OLT todavía no soporta esta corrección.');
    }

    let serviceVlan = onu.serviceConfig?.serviceVlan?.vlanId;
    if (!serviceVlan && onu.serviceConfig?.serviceVlanId) {
      const v = await this.vlanRepository.findOneBy({ id: onu.serviceConfig.serviceVlanId });
      if (v) serviceVlan = v.vlanId;
    }
    if (!serviceVlan) {
      const defaultVlan = await this.vlanRepository.findOne({
        where: { type: 'INTERNET', isActive: true },
        order: { vlanId: 'ASC' },
      });
      if (defaultVlan) serviceVlan = defaultVlan.vlanId;
    }
    if (!serviceVlan) {
      throw new BadRequestException('Esta ONU no tiene una VLAN de servicio configurada ni se encontró una VLAN para esta OLT.');
    }

    let tr069Vlan = onu.serviceConfig?.tr069Vlan?.vlanId;
    if (!tr069Vlan && onu.serviceConfig?.tr069NetworkId) {
      const net = await this.tr069Repository.findOne({
        where: { id: onu.serviceConfig.tr069NetworkId },
        relations: ['vlan'],
      });
      if (net?.vlan) tr069Vlan = net.vlan.vlanId;
    }

    const result = await withOltTelnetLock(onu.olt.id, () => driver.applyServiceGemportFix!(connParams, ponInterface, onuId, {
      serviceVlan,
      tr069Vlan,
    }));
    if (!result.ok) {
      throw new BadRequestException(`La OLT rechazó la corrección: ${result.error}`);
    }

    // Actualizar configuración local a BRIDGE tras aplicar service/gemport
    let cfg = onu.serviceConfig || (await this.configRepository.findOneBy({ onuId: onu.id }));
    if (cfg) {
      cfg.operationMode = 'BRIDGE';
      await this.configRepository.save(cfg);
    }

    return { success: true, message: 'Cableado reconstruido exitosamente con "service/gemport" en la OLT.' };
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
    return this.wanProvisioning.withMutation(id, () => this.performAuthorizeOnu(id, dto, actorUserId));
  }

  private async performAuthorizeOnu(id: string, dto: any, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const authParams = await this.buildAuthorizeParams(onu, dto);
    const connParams = await this.connectionResolver.resolve(olt);
    let config = await this.configRepository.findOneBy({ onuId: onu.id });

    // 1. Provisión en la OLT vía Telnet
    let result: Awaited<ReturnType<typeof driver.authorizeOnu>>;
    try {
      result = await withOltTelnetLock(olt.id, () => this.callDriver(() => driver.authorizeOnu(connParams, authParams)));
    } catch (error) {
      await this.recordPartialOperation(olt.id, onu.id, 'authorizeOnu');
      if (config) {
        config.desiredVersion = Math.max(config.desiredVersion, config.appliedVersion) + 1;
        config.applyStatus = 'ERROR';
        config.lastApplyError = error instanceof Error ? error.message : 'No se pudo confirmar la autorización.';
        try { await this.configRepository.save(config); }
        catch { this.logger.error(`No se pudo guardar el estado de autorización para ONU ${onu.id}.`); }
      }
      throw error;
    }
    if (!result.ok) {
      await this.recordPartialOperation(olt.id, onu.id, 'authorizeOnu');
      if (config) {
        config.desiredVersion = Math.max(config.desiredVersion, config.appliedVersion) + 1;
        config.applyStatus = 'ERROR';
        config.lastApplyError = result.error || 'La OLT no confirmó la autorización.';
        try { await this.configRepository.save(config); }
        catch { this.logger.error(`No se pudo guardar el estado de autorización para ONU ${onu.id}.`); }
      }
      throw new BadRequestException(`Fallo aprovisionando ONU en OLT: ${result.error}`);
    }
    // `result.warning` (ver IOltDriver.authorizeOnu): un paso de mejor
    // esfuerzo no crítico (hoy, en ZTE: el push OMCI de TR-069/ACS) falló sin
    // abortar el resto -- se surte igual que `cpeConfigWarning` más abajo.
    const retainedTr069Warning = config?.managementMethod === 'TR069' && config.tr069NetworkId && !dto.tr069NetworkId
      ? 'La configuración TR-069 anterior no se reaplicó durante la autorización; aplica el perfil TR-069 nuevamente.'
      : undefined;
    const oltWarning = [result.warning, retainedTr069Warning].filter(Boolean).join(' | ') || undefined;
    const isCosmeticWarning = this.isCosmeticOmciWarning(oltWarning);
    if (oltWarning && !isCosmeticWarning) await this.recordPartialOperation(olt.id, onu.id, 'authorizeOnu');
    await this.autoLearnUnsupportedOnuTypeCapabilities(onu.onuTypeId || dto.onuTypeId, oltWarning);

    try {

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
    // `tr069NetworkId` en el dto, esos campos conservan la configuración
    // deseada anterior, pero no prueban que siga aplicada tras reautorizar.
    // `wanMode` sigue siendo exclusivo de la Etapa 3.
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
        appliedVersion: oltWarning && !isCosmeticWarning ? 0 : 1,
        applyStatus: oltWarning && !isCosmeticWarning ? 'PENDING' : 'APPLIED',
        lastApplyError: oltWarning && !isCosmeticWarning ? oltWarning : null!,
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
      config.desiredVersion = Math.max(config.desiredVersion, config.appliedVersion) + 1;
      if (!oltWarning || isCosmeticWarning) config.appliedVersion = config.desiredVersion;
      config.applyStatus = oltWarning && !isCosmeticWarning ? 'PENDING' : 'APPLIED';
      config.lastApplyError = oltWarning && !isCosmeticWarning ? oltWarning : null!;
    }
    await this.configRepository.save(config);
    await this.wanProvisioning.invalidateReplacement(onu.id);

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
    if (dto.onuIndex) {
      onu.onuIndex = dto.onuIndex;
    } else {
      const assignedOnuId = (result as any)?.assignedOnuId ?? authParams.onuId;
      onu.onuIndex = authParams.ponInterface.startsWith('gpon-olt_')
        ? `${authParams.ponInterface.replace(/^gpon-olt_/, 'gpon-onu_')}:${assignedOnuId}`
        : String(assignedOnuId);
    }
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

    } catch (error) {
      await this.recordPartialOperation(olt.id, onu.id, 'authorizeOnu');
      throw error;
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'PROVISION',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ONU ${onu.serialNumber} autorizada en ${authParams.ponInterface}:${authParams.onuId}${oltWarning ? `. Advertencia: ${oltWarning}` : ' con éxito'}`,
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
    if (config.wanProvisioningMethod === 'OMCI' || config.managementMethod !== 'TR069' || !config.tr069NetworkId) return {};
    return this.wanProvisioning.withMutation(onu.id, async () => {
      const current = await this.findById(onu.id);
      if (current.serviceConfig?.operationMode === 'BRIDGE') return {};
      let result: { cpeConfigured?: boolean; cpeConfigWarning?: string };
      try {
        const pending = ['APPLYING', 'QUEUED', 'VERIFYING', 'UNKNOWN'].includes(current.serviceConfig?.wanApplyStatus || '');
        if (pending && (current.serviceConfig?.wanDesiredVersion || 0) > 0) {
          const op = await this.wanProvisioning.verify(current);
          result = { cpeConfigured: op?.status === 'APPLIED', cpeConfigWarning: op?.lastError || undefined };
        } else {
          const op = await this.wanProvisioning.configure(current, {
            provisioningMethod: 'TR069', wanMode: config.wanMode, ipProtocol: config.ipProtocol, ...wanStatic,
          }, options.actorUserId);
          result = { cpeConfigured: op.status === 'APPLIED', cpeConfigWarning: op.lastError || undefined };
        }
      } catch (error: any) {
        result = { cpeConfigured: false, cpeConfigWarning: `${options.warningPrefix}: ${error.message}` };
      }
      if (current.serviceConfig) {
        await this.persistCpeConfigStatus(current.serviceConfig, result);
      }
      return result;
    });
  }

  /**
   * Escribe el resultado REAL de `pushCpeConfiguration` en `cpe_config_status`
   * (migración 093) -- hasta ahora esa columna se declaraba, se leía (UI
   * "Confirmación del CPE", `OnuCpeSyncReconciliationService`) y jamás se
   * escribía, así que quedaba congelada en 'PENDING' para siempre sin
   * importar si GenieACS confirmaba todo. `result.cpeConfigured === undefined`
   * (no boolean) significa que esta llamada fue un no-op real (OMCI/BRIDGE/
   * sin tr069NetworkId) -- ahí no se toca el estado, porque no se intentó nada.
   */
  private async persistCpeConfigStatus(
    config: OnuServiceConfigEntity,
    result: { cpeConfigured?: boolean; cpeConfigWarning?: string },
  ): Promise<void> {
    if (result.cpeConfigured === undefined) return;
    config.cpeConfigStatus = result.cpeConfigured ? 'APPLIED' : 'ERROR';
    config.lastCpeConfigError = result.cpeConfigured ? null : result.cpeConfigWarning || 'Error desconocido aplicando configuración CPE.';
    if (result.cpeConfigured) config.cpeConfigSyncedAt = new Date();
    try {
      await this.configRepository.save(config);
    } catch (err: any) {
      this.logger.warn(`No se pudo persistir cpeConfigStatus para la ONU ${config.onuId}: ${err.message}`);
    }
  }
  /**
   * Etapa 2 del flujo de 3 etapas: apunta una ONU YA autorizada ópticamente
   * (Etapa 1, `authorizeOnu`) al ACS (chain OMCI de `tr069-mgmt`) -- SIN
   * tocar GenieACS/WAN todavía (eso es `pushWanConfig`, Etapa 3). Permite
   * reintentar este paso de forma independiente, sin re-autorizar la ONU
   * en la OLT cada vez.
   */
  /**
   * Vista previa (dry-run) del script CLI que generará "Aplicar Perfil
   * TR-069" (Etapa 2) -- misma funcionalidad que `previewAuthorizationScript`
   * para la Etapa 1 (RF-OLT-018), pedida explícitamente para este modal tras
   * confundir cuál paso de Etapa 2 estaba fallando. Reutiliza la MISMA
   * validación que `applyTr069Profile` (config de servicio previa + acsUrl no
   * vacío) para que la previsualización nunca muestre un script que la
   * ejecución real rechazaría de entrada.
   */
  async previewTr069ProfileScript(id: string, dto: { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);

    if (onu.status !== 'ACTIVE') {
      throw new BadRequestException('La ONU debe estar autorizada (ópticamente activa) en la OLT antes de previsualizar el perfil TR-069.');
    }

    // Misma relajación que performApplyTr069Profile: no exige fila de config
    // previa, ya que el script de TR-069 no depende de serviceVlanId/
    // speedProfileId/onuTypeId.
    const config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!dto.tr069NetworkId) {
      throw new BadRequestException('Selecciona una Red TR-069.');
    }

    const authParams = await this.buildAuthorizeParams(onu, {
      onuTypeId: onu.onuTypeId,
      serviceVlanId: config?.serviceVlanId,
      speedProfileId: config?.speedProfileId,
      tr069NetworkId: dto.tr069NetworkId,
      tr069AcsUsername: dto.tr069AcsUsername,
      tr069AcsPassword: dto.tr069AcsPassword,
      managementMethod: 'TR069',
      operationMode: config?.operationMode,
    }, false, true);

    if (!authParams.tr069Url) {
      throw new BadRequestException(
        'La Red TR-069 seleccionada no tiene una URL de ACS configurada (acsUrl vacío). Corrígela en "Redes TR-069" antes de aplicar el perfil.',
      );
    }

    if (typeof driver.generateTr069ProfileScript !== 'function') {
      throw new BadRequestException(`[${onu.olt.vendor}] esta previsualización todavía no está implementada para este fabricante.`);
    }

    const commands = driver.previewTr069Plan
      ? await withOltTelnetLock(onu.olt.id, async () => driver.previewTr069Plan!(await this.connectionResolver.resolve(onu.olt), authParams))
      : (await this.callDriver(async () => driver.generateTr069ProfileScript!(authParams))).map(cmd => redactOltCli(cmd));

    return {
      onuId: onu.id,
      serialNumber: onu.serialNumber,
      commands,
      totalCommands: commands.length,
      previewKind: driver.previewTr069Plan ? 'observed_diff' : 'template',
    };
  }

  async applyTr069Profile(id: string, dto: { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }, actorUserId?: string) {
    return this.wanProvisioning.withMutation(id, () => this.performApplyTr069Profile(id, dto, actorUserId));
  }

  async prepareTr069Operation(id: string, dto: { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }, kind: 'profile' | 'acs') {
    if (!!dto.tr069AcsUsername !== !!dto.tr069AcsPassword) throw new BadRequestException('Para cambiar credenciales ACS proporciona usuario y contraseña juntos.');
    const onu = await this.findById(id);
    if (onu.status !== 'ACTIVE') throw new BadRequestException('La ONU debe estar autorizada antes de aplicar TR-069.');
    if (onu.olt.vendor !== 'ZTE' || !/C320/i.test(onu.olt.model)) throw new BadRequestException('El flujo verificable TR-069 está disponible para ZTE C320.');
    const config = await this.configRepository.findOneBy({ onuId: id });
    if (!config && kind === 'profile') throw new BadRequestException('Falta configuración previa de servicio; autoriza la ONU primero.');
    if (!dto.tr069NetworkId) throw new BadRequestException('Selecciona una Red TR-069.');
    const network = await this.tr069Repository.findOneBy({ id: dto.tr069NetworkId });
    if (!network) throw new BadRequestException('La red TR-069 no existe en este tenant.');
    const auth = await this.buildAuthorizeParams(onu, {
      onuTypeId: onu.onuTypeId, serviceVlanId: config?.serviceVlanId, speedProfileId: config?.speedProfileId,
      tr069NetworkId: network.id, tr069AcsUsername: dto.tr069AcsUsername, tr069AcsPassword: dto.tr069AcsPassword,
      managementMethod: 'TR069', operationMode: config?.operationMode || 'ROUTER',
    }, kind === 'acs');
    validateTr069Input(auth, kind === 'acs');
    auth.tr069Uplinks = (await this.ifaceRepository.find({ where: { oltId: onu.olt.id, type: 'UPLINK' } })).map(iface => iface.name);
    return { auth, oltId: onu.olt.id, networkId: network.id, vlanId: network.vlanId, cidr: network.cidr, kind };
  }

  async executePreparedTr069(id: string, auth: AuthorizeOnuParams, kind: 'profile' | 'acs', expectedOltId: string): Promise<Tr069Result> {
    const onu = await this.findById(id);
    if (onu.serialNumber !== auth.serialNumber || onu.status !== 'ACTIVE') throw new BadRequestException('La identidad o estado de la ONU cambió desde la solicitud.');
    const location = this.resolveOnuLocation(onu);
    if (onu.olt.id !== expectedOltId || location.ponInterface !== auth.ponInterface || location.onuId !== auth.onuId) throw new BadRequestException('La ubicación de la ONU cambió desde la solicitud.');
    const driver = this.resolveDriver(onu.olt);
    const conn = await this.connectionResolver.resolve(onu.olt);
    const result = await withOltTelnetLock(onu.olt.id, () => kind === 'profile'
      ? driver.applyTr069Management(conn, auth)
      : driver.updateTr069AcsUrl!(conn, { ...auth, tr069Url: auth.tr069Url! }));
    if (!result.status || !result.evidence) return { ...initialTr069Result(), error: 'El driver no devolvió evidencia de configuración verificable.' };
    return result as Tr069Result;
  }

  async observeTr069Operation(id: string, version: number, serial: string, result: Tr069Result) {
    const onu = await this.findById(id);
    const config = await this.configRepository.findOneBy({ onuId: id });
    if (onu.serialNumber !== serial || config?.desiredVersion !== version) return false;
    const { ponInterface, onuId } = this.resolveOnuLocation(onu);
    const driver = this.resolveDriver(onu.olt);
    const conn = await this.connectionResolver.resolve(onu.olt);
    await withOltTelnetLock(onu.olt.id, async () => {
      if (driver.getOnuDetailInfo) {
        try {
          const detail = await driver.getOnuDetailInfo(conn, ponInterface, onuId);
          const known = !!detail.configState && !!detail.phaseState;
          result.evidence.omci = evidence(!known ? 'unknown' : detail.configState?.toLowerCase() === 'success' && detail.phaseState?.toLowerCase() === 'working' ? 'confirmed' : 'failed', 'detail-info', 'Consulta de convergencia posterior, sin mutaciones.');
        } catch { result.evidence.omci = evidence('unknown', 'detail-info', 'Consulta posterior no disponible.'); }
      }
      if (driver.getOnuIpHost) {
        try {
          const host = await driver.getOnuIpHost(conn, ponInterface, onuId);
          result.evidence.ip = evidence(host.mgmtIp ? 'confirmed' : 'unknown', 'ip-host', host.mgmtIp ? 'IP de gestión: ' + host.mgmtIp : 'Sin IP de gestión confirmada.');
        } catch { result.evidence.ip = evidence('unknown', 'ip-host', 'Consulta posterior no disponible.'); }
      }
    });
    return config?.tr069Network?.cidr || onu.serviceConfig?.tr069Network?.cidr || '';
  }

  private async performApplyTr069Profile(id: string, dto: { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    if (onu.status !== 'ACTIVE') {
      throw new BadRequestException('La ONU debe estar autorizada (ópticamente activa) en la OLT antes de aplicar el perfil TR-069.');
    }

    // El bloque TR-069 (tcont 2/gemport 2/service-port 2 en la VLAN de gestión
    // + OMCI pon-onu-mng, ver generateTr069TransportScript/
    // generateTr069ManagementScript) es autosuficiente: nunca lee
    // serviceVlanId/speedProfileId/onuTypeId para generarse -- esos campos
    // solo importan para el canal de datos (tcont 1/service-port 1), que
    // esta acción no toca. Por eso ya NO se exige una fila de config previa
    // en net.onu_service_config: aplica a cualquier ONU que la OLT ya
    // reporte autorizada (status ACTIVE), sin importar si la autorización
    // óptica la hizo este sistema o fue detectada/importada externamente
    // (ej. detectedBy=OLT_IMPORT). Si no existe fila, se crea una mínima
    // -- serviceVlanId/speedProfileId quedan en null, igual que ya permite
    // el esquema para equipos OLT_IMPORT (ver columna nullable, migración 098).
    let config = await this.configRepository.findOneBy({ onuId: onu.id });
    if (!config) {
      config = this.configRepository.create({
        onuId: onu.id,
        managementMethod: 'TR069',
        operationMode: 'ROUTER',
        desiredVersion: 1,
        appliedVersion: 0,
        applyStatus: 'PENDING',
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
      tr069AcsUsername: dto.tr069AcsUsername,
      tr069AcsPassword: dto.tr069AcsPassword,
      managementMethod: 'TR069',
      operationMode: config.operationMode,
    }, false, true);

    // Falla aquí, ANTES de conectarse a la OLT, en vez de dejar que el
    // driver genere "tr069-mgmt 1 acs " en blanco (la OLT lo aceptaría sin
    // quejarse -- es solo texto para ella -- y la ONU quedaría "configurada"
    // sin apuntar a ningún lado). Señal de una Red TR-069 con "acsUrl" vacío.
    if (!authParams.tr069Url) {
      throw new BadRequestException(
        `La Red TR-069 seleccionada no tiene una URL de ACS configurada (acsUrl vacío). Corrígela en "Redes TR-069" antes de aplicar el perfil.`,
      );
    }

    let result: Awaited<ReturnType<typeof driver.applyTr069Management>>;
    try {
      result = await withOltTelnetLock(olt.id, () => this.callDriver(() => driver.applyTr069Management(connParams, authParams)));
    } catch (error) {
      await this.recordPartialOperation(olt.id, onu.id, 'applyTr069Profile');
      throw error;
    }
    if (!result.ok) {
      await this.recordPartialOperation(olt.id, onu.id, 'applyTr069Profile');
      throw new BadRequestException(`Fallo aplicando el Perfil TR-069 en la OLT: ${result.error}`);
    }
    const isCosmeticWarning = this.isCosmeticOmciWarning(result.warning);
    if (result.warning && !isCosmeticWarning) await this.recordPartialOperation(olt.id, onu.id, 'applyTr069Profile');
    await this.autoLearnUnsupportedOnuTypeCapabilities(onu.onuTypeId, result.warning);

    try {
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
    // Bug real confirmado (2026-11-03): esta rama solo existía para el caso
    // `result.warning` -- un éxito limpio (ej. "Config state: success" tras
    // el polling de applyTr069ManagementWithSession) nunca avanzaba
    // appliedVersion/applyStatus, así que "Estado de Aprovisionamiento (OLT)"
    // se quedaba perpetuamente en "Versión Aplicada: 0" incluso cuando la OLT
    // sí confirmó el cambio. Misma simetría que ya usa authorizeOnu() arriba.
    config.desiredVersion = Math.max(config.desiredVersion, config.appliedVersion) + 1;
    if (result.warning && !isCosmeticWarning) {
      config.applyStatus = 'PENDING';
      config.lastApplyError = result.warning;
    } else {
      config.appliedVersion = config.desiredVersion;
      config.applyStatus = 'APPLIED';
      config.lastApplyError = null!;
    }
    await this.configRepository.save(config);
    } catch (error) {
      await this.recordPartialOperation(olt.id, onu.id, 'applyTr069Profile');
      throw error;
    }

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

  async updateTr069AcsUrl(id: string, dto: { tr069NetworkId: string; tr069AcsUsername?: string; tr069AcsPassword?: string }, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    if (!driver.updateTr069AcsUrl) {
      throw new BadRequestException(
        `[${olt.vendor}] esta operación (actualizar solo el ACS) todavía no está implementada para este fabricante.`,
      );
    }

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
      tr069AcsUsername: dto.tr069AcsUsername,
      tr069AcsPassword: dto.tr069AcsPassword,
      managementMethod: 'TR069',
      operationMode: config.operationMode,
    }, true);

    if (!authParams.tr069Url) {
      throw new BadRequestException(
        `La Red TR-069 seleccionada no tiene una URL de ACS configurada (acsUrl vacío). Corrígela en "Redes TR-069" antes de aplicar el cambio.`,
      );
    }

    const result = await withOltTelnetLock(olt.id, () => this.callDriver(() =>
      driver.updateTr069AcsUrl!(connParams, {
        ponInterface: authParams.ponInterface,
        onuId: authParams.onuId,
        tr069Url: authParams.tr069Url!,
        tr069AcsUsername: authParams.tr069AcsUsername,
        tr069AcsPassword: authParams.tr069AcsPassword,
      }),
    ));
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
   * Actualización masiva del puntero ACS TR-069 para 1 a N ONUs.
   * Agrupa las ONUs por OLT para reutilizar una única sesión Telnet por chasis,
   * reduciendo drásticamente el tiempo de ejecución y evitando bloqueos repetitivos.
   */
  async batchUpdateTr069AcsUrl(dto: BatchTr069AcsDto, actorUserId?: string) {
    if (!dto.onuIds || dto.onuIds.length === 0) {
      throw new BadRequestException('Debe seleccionar al menos una ONU.');
    }

    let acsUrl: string | undefined;
    let tr069AcsUsername: string | undefined;
    let tr069AcsPassword: string | undefined;
    let tr069VlanId: string | undefined;

    if (dto.tr069NetworkId) {
      const net = await this.tr069Repository.findOne({
        where: { id: dto.tr069NetworkId },
        relations: ['vlan'],
      });
      if (!net) {
        throw new NotFoundException(`La Red TR-069 seleccionada no existe.`);
      }
      if (!net.acsUrl) {
        throw new BadRequestException(`La Red TR-069 seleccionada no tiene una URL de ACS configurada.`);
      }
      acsUrl = net.acsUrl;
      tr069AcsUsername = dto.customAcs?.tr069AcsUsername?.trim() || net.acsUsername || undefined;
      tr069AcsPassword =
        dto.customAcs?.tr069AcsPassword || (net.acsPasswordEnc ? decryptCredential(net.acsPasswordEnc) : undefined);
      tr069VlanId = net.vlanId;
    } else if (dto.customAcs?.acsUrl) {
      acsUrl = dto.customAcs.acsUrl.trim();
      tr069AcsUsername = dto.customAcs.tr069AcsUsername?.trim() || undefined;
      tr069AcsPassword = dto.customAcs.tr069AcsPassword || undefined;
    } else {
      throw new BadRequestException('Debe seleccionar una Red TR-069 o proporcionar la URL del ACS en customAcs.');
    }

    for (const val of [acsUrl, tr069AcsUsername, tr069AcsPassword]) {
      if (val != null && (typeof val !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(val))) {
        throw new BadRequestException('Parámetro ACS inválido (contiene caracteres de control no permitidos).');
      }
    }

    const requestedIds = Array.from(new Set(dto.onuIds));
    const onus = await this.onuRepository.find({
      where: { id: In(requestedIds) },
      relations: ['olt', 'ponInterface', 'serviceConfig'],
    });

    const foundOnuMap = new Map(onus.map((o) => [o.id, o]));
    const results: BatchTr069AcsItemOutput[] = [];

    // Identificar ONUs no encontradas
    for (const id of requestedIds) {
      if (!foundOnuMap.has(id)) {
        results.push({
          onuId: id,
          onuInterface: '',
          ok: false,
          error: 'ONU no encontrada en la base de datos.',
        });
      }
    }

    // Agrupar ONUs válidas por OLT
    const onusByOlt = new Map<string, { olt: OltEntity; items: OnuEntity[] }>();
    for (const onu of onus) {
      if (!onu.olt) {
        results.push({
          onuId: onu.id,
          serialNumber: onu.serialNumber,
          onuInterface: '',
          ok: false,
          error: 'La ONU no tiene una OLT asociada.',
        });
        continue;
      }
      if (!onusByOlt.has(onu.olt.id)) {
        onusByOlt.set(onu.olt.id, { olt: onu.olt, items: [] });
      }
      onusByOlt.get(onu.olt.id)!.items.push(onu);
    }

    let totalSuccessful = 0;
    let totalFailed = results.filter((r) => !r.ok).length;

    // Procesar cada OLT con su Telnet Lock
    for (const [, { olt, items }] of onusByOlt.entries()) {
      const driver = this.resolveDriver(olt);
      const connParams = await this.connectionResolver.resolve(olt);

      const batchItems: BatchTr069AcsItemInput[] = items.map((onu) => {
        const { ponInterface, onuId } = this.resolveOnuLocation(onu);
        return {
          onuId: onu.id,
          ponInterface,
          onuIndex: onuId,
          serialNumber: onu.serialNumber,
          tr069Url: acsUrl!,
          tr069AcsUsername,
          tr069AcsPassword,
        };
      });

      let oltBatchResult: BatchTr069AcsResult;

      if (driver.batchUpdateTr069AcsUrl) {
        oltBatchResult = await withOltTelnetLock(olt.id, () =>
          this.callDriver(() => driver.batchUpdateTr069AcsUrl!(connParams, batchItems)),
        );
      } else if (driver.updateTr069AcsUrl) {
        // Fallback para drivers que solo tienen update individual
        const itemResults: BatchTr069AcsItemOutput[] = [];
        let okCount = 0;
        let failCount = 0;

        await withOltTelnetLock(olt.id, async () => {
          for (const item of batchItems) {
            try {
              const res = await this.callDriver(() =>
                driver.updateTr069AcsUrl!(connParams, {
                  ponInterface: item.ponInterface,
                  onuId: item.onuIndex,
                  tr069Url: item.tr069Url,
                  serialNumber: item.serialNumber,
                  tr069AcsUsername: item.tr069AcsUsername,
                  tr069AcsPassword: item.tr069AcsPassword,
                }),
              );
              if (res.ok) {
                okCount++;
                itemResults.push({
                  onuId: item.onuId,
                  serialNumber: item.serialNumber,
                  onuInterface: `${item.ponInterface}:${item.onuIndex}`,
                  ok: true,
                });
              } else {
                failCount++;
                itemResults.push({
                  onuId: item.onuId,
                  serialNumber: item.serialNumber,
                  onuInterface: `${item.ponInterface}:${item.onuIndex}`,
                  ok: false,
                  error: res.error || 'Fallo desconocido en driver OLT',
                });
              }
            } catch (err: any) {
              failCount++;
              itemResults.push({
                onuId: item.onuId,
                serialNumber: item.serialNumber,
                onuInterface: `${item.ponInterface}:${item.onuIndex}`,
                ok: false,
                error: err.message,
              });
            }
          }
        });

        oltBatchResult = {
          ok: failCount === 0,
          total: batchItems.length,
          successful: okCount,
          failed: failCount,
          results: itemResults,
        };
      } else {
        oltBatchResult = {
          ok: false,
          total: batchItems.length,
          successful: 0,
          failed: batchItems.length,
          results: batchItems.map((b) => ({
            onuId: b.onuId,
            serialNumber: b.serialNumber,
            onuInterface: `${b.ponInterface}:${b.onuIndex}`,
            ok: false,
            error: `[${olt.vendor}] Este fabricante no soporta actualización de ACS TR-069.`,
          })),
          error: `[${olt.vendor}] No implementado.`,
        };
      }

      // Persistir configuración en DB para las ONUs que tuvieron éxito
      for (const resItem of oltBatchResult.results) {
        results.push(resItem);
        if (resItem.ok) {
          totalSuccessful++;
          const targetOnu = foundOnuMap.get(resItem.onuId);
          if (targetOnu) {
            let config = targetOnu.serviceConfig || (await this.configRepository.findOneBy({ onuId: targetOnu.id }));
            if (!config) {
              config = this.configRepository.create({
                onuId: targetOnu.id,
                managementMethod: 'TR069',
                operationMode: 'ROUTER',
              });
            }
            config.managementMethod = 'TR069';
            if (dto.tr069NetworkId) {
              config.tr069NetworkId = dto.tr069NetworkId;
              if (tr069VlanId) config.tr069VlanId = tr069VlanId;
            }
            await this.configRepository.save(config);
          }
        } else {
          totalFailed++;
        }
      }

      await this.deviceOperationLogger.logEvent({
        nodeId: olt.viaNodeId || olt.id,
        eventType: 'PROVISION',
        status: oltBatchResult.successful > 0 ? 'SUCCESS' : 'FAILURE',
        message: `[${olt.vendor}] Migración masiva de ACS TR-069: ${oltBatchResult.successful}/${batchItems.length} ONUs exitosas en OLT ${olt.name}.`,
        actorUserId,
        rawDetails: {
          oltId: olt.id,
          operation: 'batchUpdateTr069AcsUrl',
          successful: oltBatchResult.successful,
          failed: oltBatchResult.failed,
          acsUrl,
        },
      });
    }

    return {
      ok: totalFailed === 0,
      total: requestedIds.length,
      successful: totalSuccessful,
      failed: totalFailed,
      results,
    };
  }

  
  async pushWanConfig(id: string, dto: ConfigureOnuWanDto, actorUserId?: string) {
    return this.wanProvisioning.withMutation(id, () => this.performPushWanConfig(id, dto, actorUserId));
  }

  private async performPushWanConfig(id: string, dto: ConfigureOnuWanDto, actorUserId?: string) {
    const onu = await this.findById(id);
    const operation = await this.wanProvisioning.configure(onu, dto, actorUserId);
    const saved = await this.findById(id);
    return {
      ...saved, operationId: operation.id, wanOperation: operation,
      cpeConfigured: operation.status === 'APPLIED',
      cpeConfigWarning: operation.lastError || (operation.status === 'APPLIED' ? undefined : 'Configuración enviada; falta confirmar su aplicación.'),
    };
  }

  /** verify()/reconcile() ya no exigen el candado por-ONU para su rama de solo lectura (ver OnuWanProvisioningService.verify). */
  async verifyWan(id: string) {
    return this.wanProvisioning.verify(await this.findById(id));
  }

  async reconcileWan(id: string) {
    return this.wanProvisioning.reconcile(await this.findById(id));
  }

  /**
   * Sincroniza y reconcilia activamente el estado del CPE en GenieACS y Sumtech:
   * 1. Resuelve el deviceId en GenieACS si no estaba resuelto.
   * 2. Asegura los tags requeridos (TENANT:<slug>, OLT:<oltName>).
   * 3. Dispara orden de refresco CWMP hacia el CPE (refreshObject).
   * 4. Actualiza cpeConfigStatus a APPLIED en la base de datos si el equipo responde/está en GenieACS.
   * 5. Registra la auditoría de operación.
   */
  async syncCpe(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    let deviceId = onu.genieacsDeviceId;
    if (!deviceId && onu.serialNumber) {
      deviceId = (await this.genieAcsDeviceResolver.resolveBySerialNumber(onu.serialNumber)) || undefined;
      if (deviceId) {
        await this.onuRepository.update(onu.id, { genieacsDeviceId: deviceId });
        onu.genieacsDeviceId = deviceId;
      }
    }

    if (!deviceId) {
      throw new BadRequestException(
        `El CPE con serial "${onu.serialNumber}" no ha sido detectado por GenieACS (aún no ha enviado su primer Inform TR-069).`,
      );
    }

    const tenantSlug = this.tenantContext.getSlug()?.toLowerCase().trim();
    const expectedTags: string[] = [];
    if (tenantSlug) expectedTags.push(`TENANT:${tenantSlug}`);
    if (onu.olt?.name) expectedTags.push(`OLT:${onu.olt.name}`);

    // Asegurar tags en GenieACS
    if (expectedTags.length > 0 && this.genieAcsDeviceResolver.ensureDeviceTags) {
      await this.genieAcsDeviceResolver.ensureDeviceTags(deviceId, expectedTags);
    }

    // Refrescar árbol CWMP
    if (this.genieAcsDeviceResolver.refreshDevice) {
      await this.genieAcsDeviceResolver.refreshDevice(deviceId);
    }

    // Obtener estado fresco y marcar como aplicado en BD
    if (onu.serviceConfig) {
      onu.serviceConfig.cpeConfigStatus = 'APPLIED';
      onu.serviceConfig.cpeConfigSyncedAt = new Date();
      onu.serviceConfig.lastCpeConfigError = null;
      await this.configRepository.save(onu.serviceConfig);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: onu.olt?.viaNodeId || onu.olt?.id || onu.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `Sincronización CPE TR-069 completada para ONU ${onu.serialNumber} (Device: ${deviceId}). Tags: ${expectedTags.join(', ')}.`,
      actorUserId,
      rawDetails: {
        onuId: onu.id,
        serialNumber: onu.serialNumber,
        deviceId,
        tags: expectedTags,
        operation: 'syncCpe',
      },
    });

    return this.findById(onu.id);
  }

  async retryWan(id: string, operationId: string, acknowledged: boolean, actorUserId?: string) {
    return this.wanProvisioning.withMutation(id, async () => this.wanProvisioning.retry(await this.findById(id), operationId, acknowledged, actorUserId));
  }
  async getWanOperation(id: string, operationId: string) {
    await this.findById(id);
    return this.wanProvisioning.getOperation(id, operationId);
  }

  async saveOmciWanProfile(id: string, dto: OnuOmciWanProfileDto, actorUserId?: string) {
    return this.wanProvisioning.withMutation(id, async () => this.wanProvisioning.saveOmciProfile(await this.findById(id), dto, actorUserId));
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
    return this.wanProvisioning.withMutation(id, () => this.performReprovisionOnu(id, dto, actorUserId));
  }

  private async performReprovisionOnu(id: string, dto: any, actorUserId?: string) {
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
    const result = await withOltTelnetLock(onu.olt.id, () => driver.setOnuAdminState(connParams, target, 'BLOCKED'));
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
    const result = await withOltTelnetLock(onu.olt.id, () => driver.setOnuAdminState(connParams, target, 'ACTIVE'));
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
/**
   * Reinicia la ONU mediante comando OMCI en la OLT.
   */
  async rebootOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);
    const { ponInterface, onuId } = this.resolveOnuLocation(onu);

    if (!driver.rebootOnu) {
      throw new BadRequestException(
        `[${olt.vendor}] La operación de reinicio no está soportada vía OMCI en este modelo de OLT.`,
      );
    }

    const result = await withOltTelnetLock(olt.id, () =>
      this.callDriver(() => driver.rebootOnu!(connParams, ponInterface, onuId)),
    );

    if (!result.ok) {
      throw new BadRequestException(`No se pudo reiniciar la ONU: ${result.error}`);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ONU ${onu.serialNumber} reiniciada vía OMCI en ${ponInterface}:${onuId}.`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, vendor: olt.vendor, driverName: driver.constructor.name, operation: 'rebootOnu' },
    });

    return { success: true, message: 'Orden de reinicio enviada correctamente a la ONU.' };
  }

  /**
   * Restablece la configuración de fábrica de la ONU mediante comando OMCI en la OLT.
   */
  async factoryResetOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);
    const { ponInterface, onuId } = this.resolveOnuLocation(onu);

    if (!driver.factoryResetOnu) {
      throw new BadRequestException(
        `[${olt.vendor}] La operación de reset de fábrica no está soportada vía OMCI en este modelo de OLT.`,
      );
    }

    const result = await withOltTelnetLock(olt.id, () =>
      this.callDriver(() => driver.factoryResetOnu!(connParams, ponInterface, onuId)),
    );

    if (!result.ok) {
      throw new BadRequestException(`No se pudo restablecer la ONU de fábrica: ${result.error}`);
    }

    await this.deviceOperationLogger.logEvent({
      nodeId: olt.viaNodeId || olt.id,
      eventType: 'COMMAND',
      status: 'SUCCESS',
      message: `[${olt.vendor}] ONU ${onu.serialNumber} restablecida a valores de fábrica vía OMCI en ${ponInterface}:${onuId}.`,
      actorUserId,
      rawDetails: { onuId: onu.id, oltId: olt.id, vendor: olt.vendor, driverName: driver.constructor.name, operation: 'factoryResetOnu' },
    });

    return { success: true, message: 'Orden de restauración de fábrica enviada correctamente a la ONU.' };
  }

  async deleteOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const olt = onu.olt;
    const driver = this.resolveDriver(olt);
    const connParams = await this.connectionResolver.resolve(olt);

    const { ponInterface, onuId } = this.resolveOnuLocation(onu);

    const result = await withOltTelnetLock(olt.id, () => this.callDriver(() => driver.deleteOnu(connParams, ponInterface, onuId)));
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
    return this.wanProvisioning.withMutation(id, () => this.performMigrateOnu(id, dto, actorUserId));
  }

  private async performMigrateOnu(id: string, dto: MigrateOnuDto, actorUserId?: string) {
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
    const { ponInterface: sourcePon, onuId } = this.resolveOnuLocation(onu);
    const ponInterface = dto.newPonInterface ?? sourcePon;
    this.resolveOnuLocation({ ...onu, ponInterface: { name: ponInterface }, onuIndex: String(onuId) } as OnuEntity);
    const destination = ponInterface === sourcePon
      ? onu.ponInterface
      : await this.ifaceRepository.findOneBy({ oltId: olt.id, name: ponInterface });
    if (!destination) throw new BadRequestException('Interfaz PON de destino no encontrada en la OLT.');
    const modelTypeName = onu.onuType?.vendorTypeName || onu.onuType?.model;
    const serviceVlan = onu.serviceConfig?.serviceVlan?.vlanId;
    if (!modelTypeName || !/^[\w.-]+$/.test(modelTypeName) || !Number.isInteger(serviceVlan) || serviceVlan! < 1 || serviceVlan! > 4094) {
      throw new BadRequestException('La ONU debe tener un tipo y una VLAN de servicio válidos para migrar.');
    }
    for (const value of [trimmedNewSerial, onu.contract?.client?.name, onu.serviceConfig?.speedProfile?.vendorTcontProfile, onu.serviceConfig?.tr069Network?.acsUrl]) {
      if (value != null && (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value))) {
        throw new BadRequestException('Parámetro CLI inválido.');
      }
    }
    let newPort: NapPortEntity | null = null;
    if (dto.newNapPortId) {
      newPort = await this.napPortRepository.findOne({ where: { id: dto.newNapPortId } });
      if (!newPort) throw new NotFoundException(`Puerto NAP no encontrado: ${dto.newNapPortId}`);
      if (newPort.status === 'OCUPADO' && newPort.onuId !== onu.id) {
        throw new BadRequestException(`El puerto NAP #${newPort.portNumber} ya está ocupado por otra ONU.`);
      }
    }

    let oltDeconfigured = false;
    let oltReauthorized = false;
    let oltWarning = '';
    await withOltTelnetLock(olt.id, async () => {
    const preflightDriver = this.resolveDriver(olt);
    const preflightParams = await this.connectionResolver.resolve(olt);
    if (!preflightDriver.getOnuSlotIdentity || ponInterface !== sourcePon) {
      throw new BadRequestException('No se puede verificar el destino físico de la migración; origen conservado.');
    }
    const destinationIdentity = await this.callDriver(() => preflightDriver.getOnuSlotIdentity!(preflightParams, ponInterface, onuId));
    if (!destinationIdentity || destinationIdentity.toUpperCase() !== oldSerial.toUpperCase()) {
      throw new BadRequestException('Identidad del destino físico desconocida o distinta de la ONU origen; origen conservado.');
    }
    // 1. Intentar desasociar hardware anterior en la OLT física
    try {
      const driver = this.resolveDriver(olt);
      const connParams = await this.connectionResolver.resolve(olt);
      const deleteResult = await this.callDriver(() => driver.deleteOnu(connParams, sourcePon, onuId));
      if (deleteResult.ok) {
        oltDeconfigured = true;
      }
    } catch (err: any) {
      this.logger.warn(`No se pudo eliminar ONU anterior ${oldSerial} en OLT ${olt.name} durante migración: ${err.message}`);
    }

    if (!oltDeconfigured) {
      throw new BadRequestException('No se pudo eliminar la ONU anterior en la OLT; migración cancelada.');
    }

    // Reautorizar antes de cambiar el serial o los vínculos en la base.
    try {
      const driver = this.resolveDriver(olt);
      const connParams = await this.connectionResolver.resolve(olt);
      const authParams: AuthorizeOnuParams = {
        ponInterface,
        onuId,
        modelTypeName,
        ethPorts: onu.onuType?.ethPorts,
        potsPorts: onu.onuType?.potsPorts,
        ethuniDhcpDelegationSupported: onu.onuType?.supportsEthuniDhcpDelegation,
        securityMgmtSupported: onu.onuType?.supportsSecurityMgmt,
        serialNumber: trimmedNewSerial,
        clientName: onu.contract?.client?.name || undefined,
        serviceVlan: serviceVlan!,
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

    if (!oltReauthorized) {
      await this.onuRepository.update(onu.id, { status: 'ERROR' });
      throw new BadRequestException(`La ONU anterior fue eliminada de la OLT, pero falló la reautorización. Requiere recuperación manual. ${oltWarning}`);
    }
    });

    if (onu.napPortId && dto.newNapPortId !== undefined && onu.napPortId !== dto.newNapPortId) {
      await this.napPortRepository.update(onu.napPortId, { status: 'DISPONIBLE', onuId: null });
      onu.napPortId = null;
    }
    if (newPort) {
      newPort.status = 'OCUPADO';
      newPort.onuId = onu.id;
      await this.napPortRepository.save(newPort);
      onu.napPortId = newPort.id;
    }
    onu.serialNumber = trimmedNewSerial;
    onu.status = 'ACTIVE';
    await this.onuRepository.update(onu.id, {
      serialNumber: onu.serialNumber,
      napPortId: onu.napPortId,
      ponInterfaceId: destination.id,
      onuIndex: onu.onuIndex.startsWith('gpon-onu_') ? `${ponInterface.replace(/^gpon-olt_/, 'gpon-onu_')}:${onuId}` : onu.onuIndex,
      status: onu.status,
    });

    await this.wanProvisioning.invalidateReplacement(onu.id);
    // Re-evaluate the destination; an OMCI recipe is never inherited by a replacement ONU.
    let cpeConfigured = false;
    if (onu.serviceConfig?.tr069Network && onu.serviceConfig.wanProvisioningMethod !== 'OMCI') {
      const result = await this.pushCpeConfiguration(onu, onu.serviceConfig, olt, {}, {
        warningPrefix: 'El equipo nuevo todavía no confirmó su WAN mediante GenieACS',
        failureLogMessagePrefix: 'Configuración WAN del equipo reemplazado',
        operation: 'migrateOnu.configureWan', actorUserId,
      });
      cpeConfigured = result.cpeConfigured === true;
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

  private resolveOnuLocation(onu: OnuEntity, dto: any = {}) {
    const ponInterface = onu.ponInterface?.name || dto.ponInterface;
    if (typeof ponInterface !== 'string' || !/^[a-zA-Z0-9_-]+(?:\/[0-9]+)*$/.test(ponInterface)) {
      throw new BadRequestException('Interfaz PON ausente o inválida.');
    }

    const index = String(onu.onuIndex ?? '');
    const fullIndex = index.match(/^gpon-onu_(\d+\/\d+\/\d+):(\d+)$/);
    if (fullIndex && ponInterface.startsWith('gpon-olt_') && ponInterface !== `gpon-olt_${fullIndex[1]}`) {
      throw new BadRequestException('El índice de ONU no corresponde a la interfaz PON.');
    }
    const rawId = dto.onuId ?? (fullIndex ? fullIndex[2] : index);
    if (!/^\d+$/.test(String(rawId)) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) < 1 || Number(rawId) > 128) {
      throw new BadRequestException('ID de ONU ausente o inválido (1-128).');
    }
    return { ponInterface, onuId: Number(rawId) };
  }

  private async buildAuthorizeParams(onu: OnuEntity, dto: any, acsOnly = false, skipServiceValidation = false): Promise<AuthorizeOnuParams> {
    const { ponInterface, onuId } = this.resolveOnuLocation(onu, dto);
    const explicitOnuId = Boolean(dto.onuId);
    const autoAllocateOnuId = !explicitOnuId && onu.status === 'UNCONFIGURED';

    // Tipo / modelo técnico -- ethPorts/potsPorts viajan también para que el
    // driver pueda auto-crear el "onu-type" en la OLT si todavía no existe
    // ahí (ver ensureOnuTypeProfile en ZteC320Driver).
    let modelTypeName: string | undefined;
    let onuTypeEthPorts: number | undefined;
    let onuTypePotsPorts: number | undefined;
    let onuTypeEthuniDhcpDelegationSupported: boolean | undefined;
    let onuTypeSecurityMgmtSupported: boolean | undefined;
    if (dto.onuTypeId && !acsOnly) {
      const type = await this.onuTypeRepository.findOneBy({ id: dto.onuTypeId });
      if (type) {
        modelTypeName = type.vendorTypeName || type.model;
        onuTypeEthPorts = type.ethPorts;
        onuTypePotsPorts = type.potsPorts;
        onuTypeEthuniDhcpDelegationSupported = type.supportsEthuniDhcpDelegation;
        onuTypeSecurityMgmtSupported = type.supportsSecurityMgmt;
      }
    }

    // VLAN de servicio
    let serviceVlan: number | undefined;
    if (dto.serviceVlanId && !acsOnly) {
      const v = await this.vlanRepository.findOneBy({ id: dto.serviceVlanId });
      if (v) serviceVlan = v.vlanId;
    }
    if (!acsOnly && !skipServiceValidation && (!modelTypeName || !/^[\w.-]+$/.test(modelTypeName))) {
      throw new BadRequestException('Selecciona un tipo de ONU válido.');
    }
    if (!acsOnly && !skipServiceValidation && (!Number.isInteger(serviceVlan) || serviceVlan! < 1 || serviceVlan! > 4094)) {
      throw new BadRequestException('Selecciona una VLAN de servicio válida (1-4094).');
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
        tr069AcsUsername = dto.tr069AcsUsername?.trim() || net.acsUsername || undefined;
        tr069AcsPassword = dto.tr069AcsPassword || (net.acsPasswordEnc ? decryptCredential(net.acsPasswordEnc) : undefined);
      }
      if (!net || !tr069Url || !Number.isInteger(tr069Vlan) || tr069Vlan! < 1 || tr069Vlan! > 4094) {
        if (!acsOnly || !net || !tr069Url) {
          throw new BadRequestException('La red TR-069 debe existir y tener URL ACS y VLAN válidas.');
        }
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

    for (const value of [onu.serialNumber, dto.clientName, dto.description, tcontProfile, trafficProfile, tr069Url, tr069AcsUsername, tr069AcsPassword]) {
      if (value != null && (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f]/.test(value))) {
        throw new BadRequestException('Parámetro CLI inválido.');
      }
    }
    if (!acsOnly && (typeof onu.serialNumber !== 'string' || !/^[\w.:-]+$/.test(onu.serialNumber))) {
      throw new BadRequestException('Número de serie inválido.');
    }
    for (const value of [tcontProfile, trafficProfile, tr069Url, tr069AcsUsername, tr069AcsPassword]) {
      if (value && /\s/.test(value)) throw new BadRequestException('Parámetro CLI inválido.');
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
      modelTypeName: modelTypeName!,
      ethPorts: onuTypeEthPorts,
      potsPorts: onuTypePotsPorts,
      ethuniDhcpDelegationSupported: onuTypeEthuniDhcpDelegationSupported,
      securityMgmtSupported: onuTypeSecurityMgmtSupported,
      serialNumber: onu.serialNumber,
      clientName: dto.clientName || undefined,
      description: dto.description || undefined,
      serviceVlan: serviceVlan!,
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
      explicitOnuId,
      autoAllocateOnuId,
    };
  }
 
  private isCosmeticOmciWarning(warning?: string): boolean {
    if (!warning) return false;
    const segments = warning.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
    if (segments.length === 0) return false;

    return segments.every((seg) => {
      const s = seg.toLowerCase();
      const isOptionalCmd =
        s.includes('security-mgmt') ||
        s.includes('dhcp-ip ethuni') ||
        s.includes('regla opcional de seguridad');
      const isIgnorableError =
        s.includes('unknown me') ||
        s.includes('63993') ||
        s.includes('command processing error') ||
        s.includes('omitida por la olt') ||
        s.includes('secundaria de gestión');
      return isOptionalCmd && isIgnorableError;
    });
  }

  /**
   * Auto-aprendizaje de compatibilidad OMCI del modelo de ONU:
   * Si la OLT reporta que la ONT rechazó "security-mgmt" o "dhcp-ip ethuni" con
   * error de ME desconocida (%Code 63993 : unknown ME), desactiva automáticamente
   * la bandera correspondiente en OnuTypeEntity. De este modo, futuras autorizaciones
   * y reaplicaciones de TR-069 para este modelo omitirán estos comandos por completo.
   */
  private async autoLearnUnsupportedOnuTypeCapabilities(onuTypeId?: string, warning?: string): Promise<void> {
    if (!onuTypeId || !warning) return;
    const lower = warning.toLowerCase();
    const hasUnknownMe = lower.includes('unknown me') || lower.includes('63993');
    if (!hasUnknownMe) return;

    const rejectsSecurity = lower.includes('security-mgmt');
    const rejectsEthuni = lower.includes('dhcp-ip ethuni');
    if (!rejectsSecurity && !rejectsEthuni) return;

    try {
      const type = await this.onuTypeRepository.findOneBy({ id: onuTypeId });
      if (!type) return;

      let changed = false;
      if (rejectsSecurity && type.supportsSecurityMgmt !== false) {
        type.supportsSecurityMgmt = false;
        changed = true;
        this.logger.log(`[auto-learn] Desactivando supportsSecurityMgmt para modelo "${type.model || type.vendorTypeName}" (${type.id}) tras rechazo OMCI unknown ME.`);
      }
      if (rejectsEthuni && type.supportsEthuniDhcpDelegation !== false) {
        type.supportsEthuniDhcpDelegation = false;
        changed = true;
        this.logger.log(`[auto-learn] Desactivando supportsEthuniDhcpDelegation para modelo "${type.model || type.vendorTypeName}" (${type.id}) tras rechazo OMCI unknown ME.`);
      }

      if (changed) {
        await this.onuTypeRepository.save(type);
      }
    } catch (err: any) {
      this.logger.warn(`[auto-learn] Error al auto-actualizar capacidades de OnuType ${onuTypeId}: ${err.message}`);
    }
  }

  /**
   * Cambia las credenciales WiFi (SSID, SSID 5GHz y contraseña) de una ONU
   * empujando la configuración vía GenieACS (TR-069).
   */
  async changeWifi(id: string, dto: StaffChangeWifiCredentialsDto, actorUserId?: string) {
    const onu = await this.onuRepository.findOne({
      where: { id },
      relations: ['contract'],
    });
    if (!onu) {
      throw new NotFoundException(`ONU no encontrada: ${id}`);
    }

    let deviceId = onu.genieacsDeviceId;
    if (!deviceId && onu.serialNumber) {
      deviceId = (await this.genieAcsDeviceResolver.resolveBySerialNumber(onu.serialNumber)) || undefined;
      if (deviceId) {
        onu.genieacsDeviceId = deviceId;
        await this.onuRepository.update(onu.id, { genieacsDeviceId: deviceId });
      }
    }

    if (!deviceId) {
      throw new NotFoundException(
        'Esta ONU aún no ha contactado a GenieACS ni tiene un Device ID registrado. Asegúrate de que el equipo esté conectado y reporte vía TR-069.',
      );
    }

    const res = await this.genieAcsWifiService.changeWifiForDevice(
      deviceId,
      { ssid: dto.ssid, ssid5g: dto.ssid5g, password: dto.password },
      'STAFF',
      onu.contract?.id,
    );

    return {
      success: true,
      ssid: res.ssid,
      ssid5g: res.ssid5g,
      message: 'Configuración Wi-Fi enviada al equipo. El CPE se reiniciará brevemente para aplicar los cambios.',
    };
  }
}
