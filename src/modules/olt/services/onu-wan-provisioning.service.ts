import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { isIP } from 'net';
import { Repository } from 'typeorm';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { CpeWanPolicyService } from '../../genieacs/services/cpe-wan-policy.service';
import { CpeConfiguratorService } from '../../genieacs/services/cpe-configurator.service';
import { affectsWanProvisioning, summarizeAcsTasks } from '../../genieacs/services/acs-wan-tasks.util';
import { resolveCpeIpv6Capabilities } from '../../genieacs/services/cpe-capabilities';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsClient } from '../../genieacs/genieacs-client';
import { NetworkAccessEntity } from '../../network/entities/network-access.entity';
import { decryptCredential, encryptCredential } from '../../network-connectivity/utils/crypto.util';
import { ConfigureOnuWanDto } from '../dto/configure-onu-wan.dto';
import { OnuOmciWanProfileDto } from '../dto/onu-omci-wan-profile.dto';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OnuWanOperationEntity } from '../entities/onu-wan-operation.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';
import { matchesZteWanConfiguration, validateOmciWanParams, validateOmciWanProfile } from '../drivers/zte-c320-wan';
import { redactOltCli } from '../utils/redact-olt-cli';
import { ConfigureOnuWanParams, OnuOmciWanProfile, WanApplyStatus, WanProvisioningMethod } from '../ports/onu-wan.types';

@Injectable()
export class OnuWanProvisioningService {
  private readonly logger = new Logger(OnuWanProvisioningService.name);
  constructor(
    @InjectRepository(OnuServiceConfigEntity) private readonly configs: Repository<OnuServiceConfigEntity>,
    @InjectRepository(OnuWanOperationEntity) private readonly operations: Repository<OnuWanOperationEntity>,
    @InjectRepository(NetworkAccessEntity) private readonly accesses: Repository<NetworkAccessEntity>,
    private readonly tenant: TenantContextService,
    private readonly policy: CpeWanPolicyService,
    private readonly registry: OltDriverRegistry,
    private readonly connections: OltConnectionResolverService,
    private readonly cpe: CpeConfiguratorService,
    @Inject(GENIEACS_CLIENT) private readonly acs: GenieAcsClient | null,
  ) {}

  withMutation<T>(onuId: string, action: () => Promise<T>): Promise<T> {
    return this.policy.withOnu(onuId, action);
  }

  async assertLegacyWanRecovery(onuId: string) {
    const c = await this.configs.findOneBy({ onuId });
    if (c?.wanProvisioningMethod || c?.wanAppliedMethod) throw new ConflictException('Esta WAN tiene un método de aprovisionamiento definido. Usa Configurar WAN; la recuperación DHCP anterior sobrescribiría PPPoE.');
  }

  /** The supplied WAN/PPPoE/NAT block is the default, with no compatibility registration step. */
  private resolveOmciProfile(onu: OnuEntity, config: OnuServiceConfigEntity): OnuOmciWanProfile {
    const prior = config.omciWanProfile;
    const preserveApplied = config.wanAppliedMethod === 'OMCI' && config.wanAppliedVersion > 0 && prior &&
      prior.oltId === onu.oltId && prior.serialNumber === onu.serialNumber && prior.serviceVlan === onu.serviceConfig?.serviceVlan?.vlanId;
    const count = onu.onuType?.ethPorts;
    const lanCount = typeof count === 'number' && count >= 1 ? Math.min(4, count) : 4;
    return {
      commandStyle: 'WAN_SERVICE', wanIndex: 1, hostId: 1,
      ethUniPorts: lanCount === 1 ? '1' : `1-${lanCount}`, ssidPorts: '1-4',
      ...(preserveApplied ? { ...prior, commandStyle: prior.commandStyle ?? 'WAN_IP' } : {}),
      oltId: onu.oltId, serialNumber: onu.serialNumber,
      enabled: true, validation: 'STANDARD',
      oltFirmware: onu.olt?.firmwareVersion || '', onuFirmware: '',
      vendorTypeName: onu.onuType?.vendorTypeName || '',
      serviceVlan: onu.serviceConfig?.serviceVlan?.vlanId!,
      evidence: 'Configuración OMCI resuelta desde la ONU y el servicio del contrato.',
    };
  }

  capabilities(onu: OnuEntity) {
    const c = onu.serviceConfig;
    const zte = onu.olt?.vendor === 'ZTE' && (/C320|C300/i.test(onu.olt?.model || '') || !onu.olt?.model);
    return {
      OMCI: {
        status: zte ? 'SUPPORTED' : 'UNSUPPORTED',
        enabled: zte && c?.operationMode === 'ROUTER',
        wanModes: ['PPPOE', 'DHCP', 'STATIC'], ipProtocols: ['IPV4'],
        reason: !zte ? 'El driver OMCI WAN está disponible para ZTE C320 / C300.'
          : c?.operationMode !== 'ROUTER' ? 'La WAN se configura en el router externo cuando la ONU está en Bridge.' : null,
      },
      TR069: {
        status: 'SUPPORTED', enabled: c?.operationMode === 'ROUTER' && c?.managementMethod === 'TR069' && !!c.tr069NetworkId,
        wanModes: ['PPPOE', 'DHCP', 'STATIC'], ipProtocols: ['IPV4', 'DUAL'],
        reason: c?.operationMode === 'BRIDGE' ? 'La ONU está en Bridge.' : !c?.tr069NetworkId ? 'Aplica el perfil TR-069 para usar GenieACS.' : null,
      },
    };
  }

  async getOperation(onuId: string, id: string) {
    const op = await this.operations.findOneBy({ id, onuId });
    if (!op) throw new NotFoundException('Operación WAN no encontrada.');
    return op;
  }

  async latestOperation(onuId: string) {
    return this.operations.createQueryBuilder('op').where('op.onuId = :onuId AND op.version >= 0', { onuId })
      .orderBy('op.version', 'DESC').getOne();
  }

  async reconcile(onu: OnuEntity) {
    if (!onu.serviceConfig) return null;
    if (onu.serviceConfig?.wanApplyStatus === 'ERROR') {
      const last = await this.latestOperation(onu.id);
      if (!last?.evidence?.safeToRetry || last.attempts >= 5 || !last.finishedAt ||
          Date.now() - last.finishedAt.getTime() < 120000 * Math.pow(2, last.attempts - 1)) return last;
    }
    if (['PENDING', 'ERROR'].includes(onu.serviceConfig?.wanApplyStatus || '')) {
      const c = onu.serviceConfig;
      return this.configure(onu, {
        provisioningMethod: c.wanProvisioningMethod || undefined, wanMode: c.wanMode, ipProtocol: c.ipProtocol,
        wanStaticIp: c.wanStaticIp, wanStaticMask: c.wanStaticMask, wanStaticGw: c.wanStaticGw,
        wanDns1: c.wanDns1, wanDns2: c.wanDns2, wanStaticIpv6: c.wanStaticIpv6,
        wanStaticIpv6PrefixLen: c.wanStaticIpv6PrefixLen, wanStaticIpv6Gw: c.wanStaticIpv6Gw,
        wanStaticIpv6Dns1: c.wanStaticIpv6Dns1, wanStaticIpv6Dns2: c.wanStaticIpv6Dns2,
      });
    }
    return this.verify(onu);
  }

  async invalidateReplacement(onuId: string) {
    return this.policy.withOnu(onuId, async () => {
      const c = await this.configs.findOneBy({ onuId });
      if (!c?.wanProvisioningMethod) return;
      await this.configs.update(c.id, { omciWanProfile: null, wanAppliedMethod: null, wanAppliedVersion: 0,
        wanDesiredVersion: (c.wanDesiredVersion || 0) + 1, wanApplyStatus: 'NOT_CONFIGURED', wanVerifiedAt: null,
        wanLastError: 'Equipo reemplazado. Revisa compatibilidad y aplica la WAN al nuevo serial.' });
      await this.operations.createQueryBuilder().update().set({ status: 'ERROR', lastError: 'El equipo fue reemplazado.', finishedAt: new Date() })
        .where('onu_id = :id AND version >= 0', { id: onuId }).execute();
    });
  }

  /**
   * Observation only: uncertain writes are never automatically repeated.
   *
   * A propósito NO toma el candado por-ONU de `policy.withOnu`: esta llamada
   * puede tardar hasta 30s esperando una sesión CWMP real contra el CPE
   * (`GenieAcsClient.refreshParameterValues`, connection_request=true), y el
   * reconciliador automático (`OnuCpeSyncReconciliationService`, cada 2 min)
   * la ejecuta para cualquier ONU que siga "sin confirmar" -- sosteniendo ese
   * candado durante esos 30s bloqueaba cualquier intento manual de
   * "Configurar WAN" que cayera en esa ventana con un 409 confuso ("Hay otra
   * operación WAN en curso"). No hace falta el candado para la consistencia:
   * `finish()` ya solo escribe si `wan_desired_version` sigue siendo la misma
   * que cuando empezó esta verificación (optimistic concurrency) -- si una
   * config() concurrente adelantó la versión mientras tanto, este resultado
   * simplemente se descarta como obsoleto en vez de corromper nada.
   */
  async verify(onu: OnuEntity) {
    const config = await this.configs.findOneBy({ onuId: onu.id });
    const op = await this.operations.findOne({ where: { onuId: onu.id, version: config?.wanDesiredVersion }, order: { version: 'DESC' } });
    if (!config || !op || !['APPLYING','QUEUED','VERIFYING','UNKNOWN'].includes(op.status)) return op;
    let evidence: Record<string, unknown> = { ...op.evidence, observedAt: new Date().toISOString() };
    let status: WanApplyStatus = op.status === 'APPLYING' ? 'UNKNOWN' : op.status;
    try {
      if (op.method === 'OMCI') {
        const driver = this.registry.resolve(onu.olt.vendor);
        if (!driver.getOnuWanConfiguration) return op;
        const p = config.omciWanProfile || this.resolveOmciProfile(onu, config);
        const conn = await this.connections.resolve(onu.olt);
        const observed = await withOltTelnetLock(onu.oltId, () => driver.getOnuWanConfiguration!(conn, this.onuInterface(onu), p.wanIndex));
        evidence = { ...evidence, configuration: observed };
        // A read cannot prove an unreadable PPP password after a timed-out write.
        const access = onu.contractId ? await this.accesses.findOneBy({ contractId: onu.contractId }) : null;
        const wanMode = config.wanMode || 'PPPOE';
        const matches = (wanMode !== 'PPPOE' || !!access?.username) &&
          matchesZteWanConfiguration(observed, p, {
            wanMode,
            username: access?.username || undefined,
            staticIp: config.wanStaticIp || undefined,
            staticMask: config.wanStaticMask || undefined,
          }) &&
          observed.serialNumber === onu.serialNumber && (!p.vendorTypeName || observed.vendorTypeName === p.vendorTypeName) &&
          observed.configState?.toLowerCase() === 'success';
        status = ['UNKNOWN','APPLYING'].includes(op.status) ? 'UNKNOWN' : matches ? 'APPLIED' : 'VERIFYING';
      } else if (this.acs && typeof op.evidence?.deviceId === 'string') {
        const tasks = await this.acs.getPendingDeviceTasks(op.evidence.deviceId);
        const blocking = tasks.filter(affectsWanProvisioning);
        const ownTaskPending = typeof op.evidence.taskId === 'string' && tasks.some(task => task && typeof task === 'object' && (task as any)._id === op.evidence?.taskId);
        status = ownTaskPending || blocking.length ? 'QUEUED' : 'VERIFYING';
        evidence = { ...evidence, pendingTasks: tasks.length, pendingWanTasks: blocking.length };
        if (!ownTaskPending && !blocking.length && typeof op.evidence.taskId === 'string' && op.evidence.expectedReadback &&
            await this.acs.isTaskComplete(op.evidence.deviceId, op.evidence.taskId)) {
          const expected = op.evidence.expectedReadback as Record<string, string>;
          const values = await this.acs.refreshParameterValues(op.evidence.deviceId, Object.keys(expected));
          if (Object.keys(expected).length && Object.entries(expected).every(([key, value]) => String(values[key]) === value)) status = 'APPLIED';
        }
      }
    } catch {
      evidence = { ...evidence, observationError: 'No se pudo consultar el equipo.' };
    }
    const defaultWarning = op.method === 'OMCI'
      ? (config.wanMode === 'DHCP'
          ? 'Pendiente de confirmar DHCP en el equipo.'
          : config.wanMode === 'STATIC'
          ? 'Pendiente de confirmar IP Estática en el equipo.'
          : 'Pendiente de confirmar en el equipo. Una lectura no confirma por sí sola la contraseña PPPoE.')
      : 'Pendiente de confirmar en el equipo. Una lectura no confirma por sí sola la contraseña PPPoE.';
    await this.finish(config, op, status, status === 'APPLIED' ? null : status === 'QUEUED' ? 'La tarea sigue en la cola de GenieACS.' : defaultWarning, evidence);
    return this.getOperation(onu.id, op.id);
  }

  /** Explicit operator decision after checking the equipment; no automatic fallback. */
  async retry(onu: OnuEntity, operationId: string, acknowledged: boolean, actor?: string) {
    if (!acknowledged) throw new BadRequestException('Confirma que revisaste el resultado en el equipo antes de reenviar.');
    return this.policy.withOnu(onu.id, async () => {
      const config = await this.configs.findOneBy({ onuId: onu.id });
      const op = await this.getOperation(onu.id, operationId);
      if (!config || op.version !== config.wanDesiredVersion || !['UNKNOWN','ERROR','VERIFYING'].includes(op.status)) {
        throw new ConflictException('Esta operación no admite reintento manual.');
      }
      if (this.acs) {
        const id = await this.acs.findDeviceBySerial(onu.serialNumber, { exactOnly: true });
        if (id) {
          const tasks = await this.acs.getPendingDeviceTasks(id);
          if (op.method === 'OMCI' && tasks.length) {
            this.logger.log(`Purgando ${tasks.length} tarea(s) pendientes en GenieACS para reintento OMCI de ${onu.serialNumber}.`);
            await this.acs.clearDeviceTasks(id);
          }
          if (op.method === 'TR069') this.assertTr069QueueAvailable(tasks);
        }
      }
      await this.finish(config, op, 'ERROR', 'Reintento solicitado tras revisión por el operador.', { ...op.evidence, retryAcknowledgedBy: actor || null });
      return this.configure(onu, {
        provisioningMethod: config.wanProvisioningMethod!, wanMode: config.wanMode, ipProtocol: config.ipProtocol,
        expectedVersion: config.wanDesiredVersion,
        wanStaticIp: config.wanStaticIp, wanStaticMask: config.wanStaticMask, wanStaticGw: config.wanStaticGw,
        wanDns1: config.wanDns1, wanDns2: config.wanDns2,
        wanStaticIpv6: config.wanStaticIpv6, wanStaticIpv6PrefixLen: config.wanStaticIpv6PrefixLen,
        wanStaticIpv6Gw: config.wanStaticIpv6Gw, wanStaticIpv6Dns1: config.wanStaticIpv6Dns1, wanStaticIpv6Dns2: config.wanStaticIpv6Dns2,
      }, actor);
    });
  }

  async saveOmciProfile(onu: OnuEntity, profile: OnuOmciWanProfileDto, actor?: string) {
    validateOmciWanProfile(profile);
    return this.policy.withOnu(onu.id, async () => {
      const c = await this.configs.findOneBy({ onuId: onu.id });
      if (!c) throw new BadRequestException('Autoriza y configura el servicio de la ONU primero.');
      if (profile.oltId !== onu.oltId || profile.serialNumber !== onu.serialNumber || profile.vendorTypeName !== onu.onuType?.vendorTypeName ||
          profile.oltFirmware !== onu.olt.firmwareVersion || profile.serviceVlan !== onu.serviceConfig?.serviceVlan?.vlanId) {
        throw new BadRequestException('La receta no coincide con el serial, firmware OLT, perfil ONU o VLAN actuales.');
      }
      if (onu.olt.vendor !== 'ZTE' || !/C320/i.test(onu.olt.model)) throw new BadRequestException('Driver WAN OMCI no disponible para esta OLT.');
      if (c.tr069NetworkId && profile.hostId === 2) throw new BadRequestException('IP-host 2 está reservado para el canal de gestión TR-069 de esta ONU.');
      if (profile.commandStyle === 'WAN_SERVICE' && typeof onu.onuType?.ethPorts === 'number') {
        const lastLanPort = Number(profile.ethUniPorts!.split('-').pop());
        if (lastLanPort > onu.onuType.ethPorts) throw new BadRequestException('El rango LAN supera los puertos Ethernet declarados para este modelo.');
      }
      const identity = (p: OnuOmciWanProfile) => JSON.stringify([
        p.oltId, p.serialNumber, p.oltFirmware, p.onuFirmware, p.vendorTypeName, p.serviceVlan, p.wanIndex, p.hostId,
        p.commandStyle ?? 'WAN_IP', ...(p.commandStyle === 'WAN_SERVICE' ? [p.ethUniPorts, p.ssidPorts] : [p.vlanProfile, p.auth]),
      ]);
      const busy = c.wanAppliedMethod === 'OMCI' || ((c.wanDesiredVersion || 0) > 0 && ['APPLYING','QUEUED','VERIFYING','UNKNOWN'].includes(c.wanApplyStatus));
      if (busy && c.omciWanProfile && identity(c.omciWanProfile) !== identity(profile)) {
        throw new ConflictException('Cambia primero la WAN a TR-069 antes de sustituir su receta activa.');
      }
      await this.tenant.getDataSource().transaction(async manager => {
        await manager.getRepository(OnuServiceConfigEntity).update(c.id, { omciWanProfile: profile });
        await manager.query(
        `INSERT INTO net.onu_wan_operations(onu_id,version,method,status,actor,request_fingerprint,evidence,finished_at)
         SELECT $1, LEAST(0,COALESCE(MIN(version),0))-1,'OMCI','NOT_CONFIGURED',$2,$3,$4,now() FROM net.onu_wan_operations WHERE onu_id=$1`,
          [onu.id, actor || null, createHash('sha256').update(JSON.stringify(profile)).digest('hex'), JSON.stringify({ action: 'OMCI_PROFILE', profile })]);
      });
      return profile;
    });
  }

  async configure(onu: OnuEntity, dto: ConfigureOnuWanDto, actor?: string): Promise<OnuWanOperationEntity> {
    return this.policy.withOnu(onu.id, async () => {
      const config = await this.configs.findOneBy({ onuId: onu.id });
      if (!config) throw new BadRequestException('Esta ONU no tiene configuración de servicio.');
      if (onu.status === 'UNCONFIGURED' || onu.status === 'AUTHORIZING') throw new BadRequestException('Autoriza la ONU primero.');
      if (config.operationMode !== 'ROUTER') throw new BadRequestException('En Bridge, configura PPPoE en el router externo.');
      const method: WanProvisioningMethod = dto.provisioningMethod || config.wanProvisioningMethod || 'TR069';
      const mode = dto.wanMode || config.wanMode || 'PPPOE';
      const protocol = dto.ipProtocol || config.ipProtocol || 'IPV4';
      if (!['OMCI','TR069'].includes(method) || !['PPPOE','DHCP','STATIC'].includes(mode) || !['IPV4','IPV6','DUAL'].includes(protocol)) throw new BadRequestException('Método o protocolo WAN inválido.');
      const caps = this.capabilities({ ...onu, serviceConfig: { ...config, serviceVlan: onu.serviceConfig?.serviceVlan } } as OnuEntity);
      if (!caps[method]?.enabled) throw new BadRequestException(caps[method]?.reason || 'Método WAN no disponible.');
      if (method === 'OMCI' && (!['PPPOE', 'DHCP', 'STATIC'].includes(mode) || protocol !== 'IPV4')) throw new BadRequestException('OMCI implementa PPPoE, DHCP y Estática IPv4.');
      const ipv6 = resolveCpeIpv6Capabilities(onu.onuType?.vendor || onu.vendor, onu.onuType?.model).capabilities;
      if (protocol !== 'IPV4' && ((mode === 'DHCP' && !ipv6.dhcpDualStack) || (mode === 'STATIC' && !ipv6.staticIpv6))) throw new BadRequestException('Este equipo no tiene soporte IPv6 confirmado para el modo WAN seleccionado.');
      if (!config.serviceVlanId || !onu.serviceConfig?.serviceVlan?.vlanId) throw new BadRequestException('Falta la VLAN real del servicio.');
      let pppoePasswordEnc: string | null = null;
      let username: string | undefined;
      let password: string | undefined;
      if (mode === 'PPPOE') {
        if (dto.pppoeUsername && dto.pppoePassword) {
          username = dto.pppoeUsername.trim();
          password = dto.pppoePassword.trim();
          pppoePasswordEnc = encryptCredential(password);
        } else if (onu.contractId) {
          const access = await this.accesses.findOneBy({ contractId: onu.contractId });
          pppoePasswordEnc = access?.pppoePasswordEnc || null;
          username = access?.username || undefined;
          password = access?.pppoePasswordEnc ? decryptCredential(access.pppoePasswordEnc) : undefined;
        }

        if (!username || !password) {
          if (!onu.contractId) {
            throw new BadRequestException('Esta ONU no tiene un contrato vinculado. Introduce las credenciales PPPoE manualmente o vincula un contrato.');
          }
          throw new BadRequestException('El contrato necesita usuario y contraseña PPPoE propios guardados. Introdúcelos manualmente o configúralos en el contrato.');
        }
      }

      const desired = {
        wanMode: mode, ipProtocol: protocol,
        wanStaticIp: mode === 'STATIC' ? dto.wanStaticIp ?? config.wanStaticIp ?? null : null,
        wanStaticMask: mode === 'STATIC' ? dto.wanStaticMask ?? config.wanStaticMask ?? null : null,
        wanStaticGw: mode === 'STATIC' ? dto.wanStaticGw ?? config.wanStaticGw ?? null : null,
        wanDns1: dto.wanDns1 ?? null, wanDns2: dto.wanDns2 ?? null,
        wanStaticIpv6: dto.wanStaticIpv6 ?? null, wanStaticIpv6PrefixLen: dto.wanStaticIpv6PrefixLen ?? null,
        wanStaticIpv6Gw: dto.wanStaticIpv6Gw ?? null, wanStaticIpv6Dns1: dto.wanStaticIpv6Dns1 ?? null, wanStaticIpv6Dns2: dto.wanStaticIpv6Dns2 ?? null,
      };
      if (mode === 'STATIC' && (!desired.wanStaticIp || !desired.wanStaticMask || !desired.wanStaticGw)) throw new BadRequestException('Faltan IP, máscara y gateway estáticos.');
      if (mode === 'STATIC' && [desired.wanStaticIp, desired.wanStaticMask, desired.wanStaticGw].some(v => isIP(v || '') !== 4)) throw new BadRequestException('Dirección IPv4 estática inválida.');
      if (mode === 'STATIC' && protocol !== 'IPV4' && (isIP(desired.wanStaticIpv6 || '') !== 6 || isIP(desired.wanStaticIpv6Gw || '') !== 6 || !desired.wanStaticIpv6PrefixLen)) throw new BadRequestException('Faltan parámetros IPv6 estáticos válidos.');

      const iface = this.onuInterface(onu);
      const effectiveProfile = method === 'OMCI' ? this.resolveOmciProfile(onu, config) : null;
      const omciInput: ConfigureOnuWanParams | null = effectiveProfile ? {
        onuInterface: iface,
        serialNumber: onu.serialNumber,
        profile: effectiveProfile,
        wanMode: mode,
        username,
        password,
        wanStaticIp: desired.wanStaticIp || undefined,
        wanStaticMask: desired.wanStaticMask || undefined,
        wanStaticGw: desired.wanStaticGw || undefined,
      } : null;
      if (omciInput) validateOmciWanParams(omciInput);
      const fingerprint = createHash('sha256').update(JSON.stringify({ desired, method, serial: onu.serialNumber, profile: effectiveProfile, credential: pppoePasswordEnc, username })).digest('hex');
      const prior = await this.operations.createQueryBuilder('op').addSelect('op.requestFingerprint')
        .where('op.onuId = :id AND op.version >= 0', { id: onu.id }).orderBy('op.version', 'DESC').getOne();
      // Un envío idéntico al que ya está vigente en esta versión se devuelve tal
      // cual (evita reencolar dos veces un doble clic accidental) -- pero
      // cualquier cambio real (otra contraseña, otro modo, etc.) siempre
      // sustituye a la operación anterior sin esperar a que se resuelva.
      // TR-069 no permite leer de vuelta una contraseña PPPoE, así que una
      // operación puede quedar "sin confirmar" indefinidamente sin que eso
      // deba impedirle al operador reintentar cuantas veces haga falta
      // (estamos dentro del candado por-ONU de `policy.withOnu`, así que un
      // estado "APPLYING" encontrado aquí es necesariamente de un intento
      // anterior ya terminado -- nunca de uno corriendo en este instante).
      // ERROR queda fuera a propósito: ese estado ya tiene su propio mecanismo
      // de reintento con backoff más abajo (`resumeSafeAttempt`), que decide
      // si corresponde reintentar ahora o seguir esperando.
      if (prior && prior.status !== 'ERROR' && prior.version === config.wanDesiredVersion && prior.requestFingerprint === fingerprint) {
        return this.getOperation(onu.id, prior.id);
      }
      if (dto.expectedVersion !== undefined && dto.expectedVersion !== (config.wanDesiredVersion || 0)) {
        throw new ConflictException('La configuración WAN cambió. Actualiza la ficha antes de aplicar.');
      }

      // Drain prior ACS writers before handing the same connection to OMCI.
      const acsDeviceForHandover = method === 'OMCI' ? await this.ensureAcsDrained(onu) : undefined;
      if (method === 'TR069' && this.acs) {
        const id = await this.acs.findDeviceBySerial(onu.serialNumber, { exactOnly: true });
        if (id) this.assertTr069QueueAvailable(await this.acs.getPendingDeviceTasks(id));
      }
      const resumeSafeAttempt = !actor && prior?.version === config.wanDesiredVersion && prior.status === 'ERROR' &&
        prior.requestFingerprint === fingerprint && prior.evidence?.safeToRetry === true;
      const version = resumeSafeAttempt ? config.wanDesiredVersion : (config.wanDesiredVersion || 0) + 1;
      const op = await this.tenant.getDataSource().transaction(async manager => {
        const changed = await manager.getRepository(OnuServiceConfigEntity).createQueryBuilder().update()
          .set({ ...desired, ...(effectiveProfile ? { omciWanProfile: effectiveProfile } : {}), wanProvisioningMethod: method, wanDesiredVersion: version, wanApplyStatus: 'APPLYING', wanLastError: null } as any)
          .where('id = :id AND wan_desired_version = :old', { id: config.id, old: config.wanDesiredVersion || 0 }).execute();
        if (changed.affected !== 1) throw new ConflictException('Conflicto de versión WAN.');
        if (resumeSafeAttempt) {
          const patch = { status: 'APPLYING' as const, attempts: prior!.attempts + 1, lastError: null, evidence: null, finishedAt: null };
          await manager.getRepository(OnuWanOperationEntity).update(prior!.id, patch);
          return { ...prior!, ...patch };
        }
        return manager.getRepository(OnuWanOperationEntity).save(manager.getRepository(OnuWanOperationEntity).create({
          onuId: onu.id, version, method, status: 'APPLYING', actor, attempts: 1, requestFingerprint: fingerprint,
        }));
      });

      let status: WanApplyStatus = 'UNKNOWN';
      let warning: string | null = null;
      let evidence: Record<string, unknown> | null = null;
      try {
        if (omciInput) {
          if (acsDeviceForHandover && this.acs) await this.acs.setDeviceTag(acsDeviceForHandover, 'WAN_OMCI');
          const driver = this.registry.resolve(onu.olt.vendor);
          if (!driver.configureOnuWan) throw new BadRequestException('El driver no implementa configuración WAN OMCI.');
          const conn = await this.connections.resolve(onu.olt);
          const result = await withOltTelnetLock(onu.oltId, () => driver.configureOnuWan!(conn, omciInput));
          status = result.status; warning = result.warning || null;
          evidence = result.configuration ? { configuration: result.configuration } : null;
        } else {
          const net = onu.serviceConfig?.tr069Network;
          if (!net) throw new BadRequestException('La red TR-069 ya no está disponible.');
          let acsDeviceId: string | undefined;
          let acsManufacturer: string | undefined;
          if (this.acs) {
            acsDeviceId = (await this.acs.findDeviceBySerial(onu.serialNumber, { exactOnly: true })) || undefined;
            if (acsDeviceId) {
              await this.acs.deleteDeviceTag(acsDeviceId, 'WAN_OMCI');
              try {
                const status = await this.acs.getDeviceStatus(acsDeviceId);
                acsManufacturer = status.manufacturer;
              } catch { /* continuar si la consulta de estado falla */ }
            }
          }
          const rawVendor = onu.onuType?.vendor || onu.vendor;
          const effectiveVendor = (!rawVendor || rawVendor.toUpperCase() === 'ALL' || rawVendor.toUpperCase() === 'GENERIC')
            ? (acsManufacturer || rawVendor)
            : rawVendor;

          const result = await this.policy.withManagedWrite(onu.id, 'TR069', version, () => this.cpe.configureCpe({
            serialNumber: onu.serialNumber, vendor: effectiveVendor, model: onu.onuType?.model,
            tenantSlug: this.tenant.getSlug(), oltName: onu.olt.name, operationMode: 'ROUTER',
            ...desired, pppoeUsername: username, pppoePassword: password, serviceVlan: onu.serviceConfig!.serviceVlan!.vlanId,
            dns1: desired.wanDns1 || undefined, dns2: desired.wanDns2 || undefined,
            managementServer: {
              acsUrl: net.acsUrl, acsUsername: net.acsUsername || undefined,
              acsPassword: net.acsPasswordEnc ? decryptCredential(net.acsPasswordEnc) : undefined,
              connReqUsername: net.connReqUsername || undefined,
              connReqPassword: net.connReqPasswordEnc ? decryptCredential(net.connReqPasswordEnc) : undefined,
              informIntervalSec: net.informIntervalSec,
            },
          } as any));
          status = result.applicationStatus || 'VERIFYING'; warning = result.warning || null;
          if (result.ipv6Readback?.prefix || result.ipv6Readback?.address) {
            await this.configs.update({ id: config.id, wanDesiredVersion: version }, {
              ...(result.ipv6Readback.prefix ? { pppoeIpv6Prefix: result.ipv6Readback.prefix } : {}),
              ...(result.ipv6Readback.address ? { pppoeIpv6Address: result.ipv6Readback.address } : {}),
            });
          }
          evidence = { deviceId: result.deviceId, taskId: result.taskId, parameterCount: result.appliedParametersCount, expectedReadback: result.expectedReadback };
        }
      } catch (error: any) {
        // Errors may contain credentials or a command echo. Keep raw failures out of storage/API.
        let reason = redactOltCli(String(error?.message || 'Error de comunicación'));
        if (password) reason = reason.split(password).join('***');
        status = 'UNKNOWN'; warning = `No se pudo confirmar la operación WAN: ${reason.slice(0, 500)}. Verifica el equipo antes de reintentar.`;
        if (method === 'TR069' && (error instanceof NotFoundException || error instanceof ServiceUnavailableException)) {
          status = 'ERROR'; evidence = { safeToRetry: true };
          warning = 'El CPE todavía no está disponible en GenieACS. Se reintentará con espera progresiva, hasta cinco intentos.';
        }
      }
      await this.finish(config, op, status, warning, evidence);
      return (await this.operations.findOneBy({ id: op.id, onuId: onu.id }))!;
    });
  }

  private assertTr069QueueAvailable(tasks: unknown[]): void {
    const blocking = tasks.filter(affectsWanProvisioning);
    if (!blocking.length) return;
    const summaries = summarizeAcsTasks(blocking);
    const types = [...new Set(summaries.map(t => t.name))].join(', ');
    throw new ConflictException({
      statusCode: 409, error: 'Conflict', code: 'WAN_ACS_TASKS_PENDING',
      message: `Hay ${blocking.length} tarea(s) ACS pendientes que pueden modificar la WAN o interrumpir el equipo (${types}). Revisa sus resultados y fallos en GenieACS antes de reenviar.`,
      pendingTasks: summaries,
    });
  }

  private async ensureAcsDrained(onu: OnuEntity): Promise<string | undefined> {
    if (!this.acs) return undefined;
    try {
      const deviceId = await this.acs.findDeviceBySerial(onu.serialNumber, { exactOnly: true });
      if (!deviceId) return undefined;
      const tasks = await this.acs.getPendingDeviceTasks(deviceId);
      if (tasks.length) {
        this.logger.log(`Limpiando ${tasks.length} tarea(s) pendientes en GenieACS para ${onu.serialNumber} antes de aplicar OMCI.`);
        await this.acs.clearDeviceTasks(deviceId);
      }
      return deviceId;
    } catch (err: any) {
      this.logger.warn(`No se pudo purgar la cola ACS de ${onu.serialNumber}: ${err?.message}. Continuando con provisión OMCI.`);
      return undefined;
    }
  }

  private onuInterface(onu: OnuEntity): string {
    if (/^gpon-onu_\d+\/\d+\/\d+:\d+$/.test(onu.onuIndex)) return onu.onuIndex;
    if (/^\d+\/\d+\/\d+:\d+$/.test(onu.onuIndex)) return `gpon-onu_${onu.onuIndex}`;
    return `${onu.ponInterface?.name.replace(/^gpon-olt_/, 'gpon-onu_')}:${onu.onuIndex}`;
  }

  private async finish(config: OnuServiceConfigEntity, op: OnuWanOperationEntity, status: WanApplyStatus, error: string | null, evidence: Record<string, unknown> | null) {
    await this.tenant.getDataSource().transaction(async manager => {
      const applied = status === 'APPLIED';
      const updated = await manager.getRepository(OnuServiceConfigEntity).update({ id: config.id, wanDesiredVersion: op.version, wanProvisioningMethod: op.method }, {
        wanApplyStatus: status, wanLastError: error,
        ...(applied ? { wanAppliedVersion: op.version, wanAppliedMethod: op.method, wanVerifiedAt: new Date() } : {}),
        ...(applied && op.method === 'TR069' ? { cpeConfigStatus: 'APPLIED', cpeConfigSyncedAt: new Date(), lastCpeConfigError: null } : {}),
      });
      if (updated.affected !== 1) throw new ConflictException('El resultado pertenece a una versión WAN obsoleta.');
      await manager.getRepository(OnuWanOperationEntity).update(op.id, { status, lastError: error, evidence: evidence as any, finishedAt: ['APPLIED', 'ERROR'].includes(status) ? new Date() : null });
    });
  }
}
