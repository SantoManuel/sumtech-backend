import { Injectable, Logger, NotFoundException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { VlanEntity } from '../entities/vlan.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { CpeConfiguratorService } from '../../genieacs/services/cpe-configurator.service';
import {
  IOltDriver,
  OltConnectionParams,
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
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly deviceOperationLogger: DeviceOperationLogger,
    private readonly cpeConfiguratorService: CpeConfiguratorService,
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
   */
  async findUnconfigured(oltId?: string) {
    const where: any = { status: 'UNCONFIGURED' };
    if (oltId) where.oltId = oltId;

    return this.onuRepository.find({
      where,
      relations: ['olt', 'ponInterface'],
      order: { detectedAt: 'DESC' },
    });
  }

  /**
   * Listado general de ONUs con filtros opcionales.
   */
  async findAll(options?: { oltId?: string; status?: string; search?: string }) {
    const qb = this.onuRepository
      .createQueryBuilder('onu')
      .leftJoinAndSelect('onu.olt', 'olt')
      .leftJoinAndSelect('onu.ponInterface', 'ponInterface')
      .leftJoinAndSelect('onu.onuType', 'onuType')
      .leftJoinAndSelect('onu.contract', 'contract')
      .leftJoinAndSelect('contract.client', 'client')
      .leftJoinAndSelect('onu.serviceConfig', 'serviceConfig')
      .orderBy('onu.updatedAt', 'DESC');

    if (options?.oltId) {
      qb.andWhere('onu.oltId = :oltId', { oltId: options.oltId });
    }
    if (options?.status) {
      qb.andWhere('onu.status = :status', { status: options.status });
    }
    if (options?.search) {
      const q = `%${options.search}%`;
      qb.andWhere(
        '(onu.serialNumber ILIKE :q OR onu.mac ILIKE :q OR client.firstName ILIKE :q OR client.lastName ILIKE :q)',
        { q },
      );
    }

    return qb.getMany();
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
    return onu;
  }

  /**
   * Escanea ONUs no configuradas en una OLT (RF-OLT-014).
   */
  async scanUnconfiguredOnus(oltId: string, actorUserId?: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException(`OLT no encontrada: ${oltId}`);

    const driver = this.resolveDriver(olt);
    const connParams = await this.resolveOltConnectionParams(olt);
    const discovered = await this.callDriver(() => driver.getUnconfiguredOnus(connParams));

    const savedOnus: OnuEntity[] = [];

    for (const item of discovered) {
      let existing = await this.onuRepository.findOneBy({
        oltId: olt.id,
        serialNumber: item.serialNumber,
      });

      // Buscar interfaz PON correspondiente en la base de datos
      const ponIface = await this.ifaceRepository.findOneBy({
        oltId: olt.id,
        name: item.ponInterface,
      });

      if (!existing) {
        existing = this.onuRepository.create({
          oltId: olt.id,
          ponInterfaceId: ponIface?.id,
          onuIndex: item.onuIndex,
          serialNumber: item.serialNumber,
          vendor: item.vendor,
          status: 'UNCONFIGURED',
          detectedBy: 'OLT_POLL',
          detectedAt: new Date(),
        });
      } else {
        existing.onuIndex = item.onuIndex;
        if (ponIface) existing.ponInterfaceId = ponIface.id;
        existing.lastSeenAt = new Date();
      }

      savedOnus.push(await this.onuRepository.save(existing));
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
   * Obtiene la telemetría de potencia óptica en vivo (RF-OLT-015).
   */
  async getOpticalTelemetry(id: string) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const connParams = await this.resolveOltConnectionParams(onu.olt);

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
    await this.onuRepository.save(onu);

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
    const connParams = await this.resolveOltConnectionParams(olt);

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
    // No reasignar onu.serviceConfig aquí: la relación ya no tiene cascade
    // (ver nota en onu.entity.ts) precisamente para que el save() de más
    // abajo no reintente persistir esta misma fila por su cuenta.
    await this.configRepository.save(config);

    // 3. Actualizar estado de la ONU en net.onus
    onu.status = 'ACTIVE';
    onu.authorizedAt = new Date();
    onu.authorizedByUserId = actorUserId;
    onu.contractId = dto.contractId || onu.contractId;
    onu.onuTypeId = dto.onuTypeId || onu.onuTypeId;
    if (dto.onuIndex) onu.onuIndex = dto.onuIndex;

    await this.onuRepository.save(onu);

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

        await this.cpeConfiguratorService.configureCpe({
          serialNumber: onu.serialNumber,
          vendor: onuType?.vendor,
          model: onuType?.model,
          operationMode: dto.operationMode || 'ROUTER',
          wanMode: dto.wanMode || 'PPPOE',
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
   * Bloquea el tráfico óptico de la ONU (RF-OLT-017).
   */
  async blockOnu(id: string, actorUserId?: string) {
    const onu = await this.findById(id);
    const driver = this.resolveDriver(onu.olt);
    const connParams = await this.resolveOltConnectionParams(onu.olt);

    const target = this.buildOnuTarget(onu);
    const result = await driver.setOnuAdminState(connParams, target, 'BLOCKED');
    if (!result.ok) {
      throw new BadRequestException(`No se pudo bloquear la ONU: ${result.error}`);
    }

    onu.status = 'BLOCKED';
    await this.onuRepository.save(onu);

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
    const connParams = await this.resolveOltConnectionParams(onu.olt);

    const target = this.buildOnuTarget(onu);
    const result = await driver.setOnuAdminState(connParams, target, 'ACTIVE');
    if (!result.ok) {
      throw new BadRequestException(`No se pudo reactivar la ONU: ${result.error}`);
    }

    onu.status = 'ACTIVE';
    await this.onuRepository.save(onu);

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

  private async resolveOltConnectionParams(olt: OltEntity): Promise<OltConnectionParams> {
    let host = olt.host;
    let port = olt.port || 23;

    if (olt.connectionMethod === 'VIA_MIKROTIK') {
      if (!olt.viaNodeId) {
        throw new BadRequestException(`La OLT "${olt.name}" no tiene router MikroTik de salto configurado.`);
      }
      const node = await this.nodeRepository.findOneBy({ id: olt.viaNodeId });
      if (!node) throw new NotFoundException('Router MikroTik de salto no encontrado.');

      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = olt.natPort || 2323;
    }

    const password = decryptCredential(olt.passwordEnc);
    const enablePassword = olt.enablePasswordEnc ? decryptCredential(olt.enablePasswordEnc) : undefined;

    return {
      host,
      port,
      username: olt.username,
      password,
      enablePassword,
    };
  }
}
