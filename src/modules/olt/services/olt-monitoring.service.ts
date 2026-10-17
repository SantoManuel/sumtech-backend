import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { Repository, LessThan, MoreThanOrEqual } from 'typeorm';
import axios from 'axios';
import { OltEntity } from '../entities/olt.entity';
import { OltMetricEntity } from '../entities/olt-metric.entity';
import { OnuEntity } from '../entities/onu.entity';
import { CompanyProfileEntity } from '../../company/entities/company-profile.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { TenantIteratorService } from '../../../common/tenancy/tenant-iterator.service';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OnuManagementService } from './onu-management.service';
import {
  IOltDriver,
  OltConnectionParams,
  UnknownOltVendorError,
} from '../ports/olt-driver.port';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';

@Injectable()
export class OltMonitoringService {
  private readonly logger = new Logger(OltMonitoringService.name);

  constructor(
    @InjectRepository(OltEntity)
    private readonly oltRepository: Repository<OltEntity>,
    @InjectRepository(OltMetricEntity)
    private readonly metricRepository: Repository<OltMetricEntity>,
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    @InjectRepository(CompanyProfileEntity)
    private readonly companyProfileRepository: Repository<CompanyProfileEntity>,
    @InjectRepository(NetworkNodeEntity)
    private readonly nodeRepository: Repository<NetworkNodeEntity>,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly tenantIterator: TenantIteratorService,
    private readonly onuManagementService: OnuManagementService,
  ) {}

  /**
   * Resuelve el driver real del fabricante — nunca cae en ZteC320Driver por
   * defecto para un vendor desconocido (mismo patrón que OltManagementService).
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

  /** Mismo patrón que OltManagementService.resolveOltConnectionParams(). */
  private async resolveOltConnectionParams(olt: OltEntity): Promise<OltConnectionParams> {
    let host = olt.host;
    let port = olt.port || 23;

    if (olt.connectionMethod === 'VIA_MIKROTIK') {
      if (!olt.viaNodeId) {
        throw new BadRequestException(`La OLT "${olt.name}" usa VIA_MIKROTIK pero no tiene viaNodeId.`);
      }
      const node = await this.nodeRepository.findOneBy({ id: olt.viaNodeId });
      if (!node) {
        throw new NotFoundException(`Router MikroTik asignado no encontrado.`);
      }
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = olt.natPort || 2323;
    }

    const password = decryptCredential(olt.passwordEnc);
    const enablePassword = olt.enablePasswordEnc ? decryptCredential(olt.enablePasswordEnc) : undefined;

    return { host, port, username: olt.username, password, enablePassword };
  }

  /**
   * Recolecta métricas en vivo de la OLT, persiste un snapshot y envía alertas si es necesario.
   * RF-OLT-005.
   *
   * Nunca inventa datos: cada campo de salud (CPU/memoria/temperatura/uptime)
   * y el inventario de tarjetas solo se llenan si el driver del fabricante
   * declara esa capacidad como real (ver OltDriverCapabilities). Si no, el
   * campo queda `undefined` (las columnas son nullable) en vez de un número
   * simulado. Las alarmas quedan vacías hasta que exista una fuente real
   * (pendiente: `show log` en HiOSO, sin investigar en ZTE).
   */
  async collectAndRecordMetrics(oltId: string): Promise<OltMetricEntity> {
    const olt = await this.oltRepository.findOne({
      where: { id: oltId },
      relations: ['interfaces'],
    });
    if (!olt) throw new NotFoundException(`OLT no encontrada: ${oltId}`);

    // Conteo de ONUs registradas en esta OLT (siempre real, consulta directa)
    const activeCount = await this.onuRepository.count({
      where: { oltId: olt.id, status: 'ACTIVE' },
    });
    const blockedOrOfflineCount = await this.onuRepository.count({
      where: [{ oltId: olt.id, status: 'BLOCKED' }, { oltId: olt.id, status: 'UNCONFIGURED' }],
    });

    const driver = this.resolveDriver(olt);
    const capabilities = driver.getCapabilities();
    const connParams = await this.resolveOltConnectionParams(olt);

    let cpuUsagePercent: number | undefined;
    let memoryUsagePercent: number | undefined;
    let temperatureCelsius: number | undefined;
    let uptimeSeconds: number | undefined;
    let cardsInfo: OltMetricEntity['cardsInfo'] = [];
    // Alarmas reales: solo HiOSO tiene fuente real implementada (`show log
    // flash`, confirmado contra hardware real) -- ZTE/Huawei/HSGQ siguen sin
    // evidencia y quedan en `capabilities.alarms === false`. Nunca fabricar
    // una alarma a partir de otro dato simulado.
    let alarmsInfo: OltMetricEntity['alarmsInfo'] = [];

    // Las 3 consultas Telnet de esta OLT se serializan entre sí Y contra
    // cualquier otra operación Telnet sobre la misma OLT (ver
    // withOltTelnetLock) -- bug real confirmado en producción: este cron y
    // handleScheduledOnuDiscovery() comparten exactamente el mismo horario
    // ('0 */15 * * * *'), y sin este lock ambos abren sesiones Telnet
    // concurrentes contra el mismo equipo, que solo tolera una a la vez
    // (se observó un cuelgue total, no solo lentitud, incluso con 180s de margen).
    await withOltTelnetLock(olt.id, async () => {
      if (capabilities.systemHealth) {
        try {
          const health = await driver.getSystemHealth(connParams);
          cpuUsagePercent = health.cpuUsagePercent;
          memoryUsagePercent = health.memoryUsagePercent;
          temperatureCelsius = health.temperatureCelsius;
          uptimeSeconds = health.uptimeSeconds;
        } catch (err: any) {
          this.logger.warn(`[${olt.vendor}] Error consultando salud de OLT "${olt.name}": ${err.message}`);
        }
      }

      if (capabilities.chassisCards) {
        try {
          const cards = await driver.getCards(connParams);
          cardsInfo = cards.map((c) => ({
            slot: String(c.slot),
            cardType: c.cardType,
            status: c.status,
            ports: c.portCount,
            softwareVersion: c.softVer,
          }));
        } catch (err: any) {
          this.logger.warn(`[${olt.vendor}] Error consultando tarjetas de OLT "${olt.name}": ${err.message}`);
        }
      }

      if (capabilities.alarms) {
        try {
          alarmsInfo = await driver.getAlarms(connParams);
        } catch (err: any) {
          this.logger.warn(`[${olt.vendor}] Error consultando alarmas de OLT "${olt.name}": ${err.message}`);
        }
      }
    });

    const ponInterfacesCount = olt.interfaces?.filter((i) => i.type === 'PON').length;

    const metric = this.metricRepository.create({
      oltId: olt.id,
      cpuUsagePercent,
      memoryUsagePercent,
      temperatureCelsius,
      uptimeSeconds,
      activeOnusCount: activeCount,
      offlineOnusCount: blockedOrOfflineCount,
      alarmsCount: alarmsInfo.length,
      cardsInfo,
      alarmsInfo,
      rawTelemetry: {
        vendor: olt.vendor,
        model: olt.model,
        ponInterfacesCount,
      },
    });

    const saved = await this.metricRepository.save(metric);

    // Alerta por Telegram solo ante anomalías reales
    if (alarmsInfo.length > 0 || blockedOrOfflineCount > 5) {
      await this.sendTelegramAlert(
        `🚨 *Alerta OLT: ${olt.name}*\n` +
        (temperatureCelsius !== undefined ? `• Temperatura: ${temperatureCelsius}°C\n` : '') +
        (cpuUsagePercent !== undefined ? `• CPU: ${cpuUsagePercent}%\n` : '') +
        `• ONUs Activas: ${activeCount} | Caídas: ${blockedOrOfflineCount}\n` +
        `• Alarmas: ${alarmsInfo.map((a) => a.description).join(', ')}`,
      );
    }

    return saved;
  }

  /**
   * Borra métricas con más de 30 días de antigüedad. Antes se ejecutaba
   * dentro de `collectAndRecordMetrics()` -- un DELETE global (no filtrado
   * por OLT) en CADA muestra individual, redundante cuando hay varias OLTs o
   * llamadas seguidas. Ahora se ejecuta una sola vez por ciclo del cron de
   * sondeo periódico (ver `handleScheduledMetricsPolling`).
   */
  private async cleanupOldMetrics(): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await this.metricRepository.delete({
      createdAt: LessThan(thirtyDaysAgo),
    });
  }

  /**
   * Sondeo periódico de telemetría OLT cada 15 minutos. Antes de esto, una
   * fila de `net.olt_metrics` SOLO se creaba cuando un humano abría el modal
   * de monitoreo (primera carga) o apretaba "Refrescar" -- la pestaña
   * "Histórico (7 días)" nunca tenía una serie de tiempo real, solo los
   * puntos dispersos que alguien hubiera generado manualmente. Mismo patrón
   * que DeviceHealthService.handleScheduledHealthChecks(): una OLT caída o
   * inalcanzable no debe abortar el sondeo del resto.
   */
  @Cron('0 */15 * * * *')
  async handleScheduledMetricsPolling(): Promise<void> {
    await this.tenantIterator.runForEachActiveTenant('olt-metrics-poll', async () => {
      const olts = await this.oltRepository.find({ where: { isActive: true } });
      if (olts.length === 0) return;

      this.logger.log(`Sondeo periódico de telemetría OLT para ${olts.length} OLT(s)...`);
      for (const olt of olts) {
        try {
          await this.collectAndRecordMetrics(olt.id);
        } catch (err: any) {
          this.logger.warn(`Sondeo periódico falló para OLT "${olt.name}": ${err.message}`);
        }
      }

      await this.cleanupOldMetrics();
    });
  }

  /**
   * Escaneo periódico de ONUs sin configurar (RF-OLT-014) cada 15 minutos.
   * Antes de esto, `scanUnconfiguredOnus()` solo se disparaba cuando un
   * admin hacía clic en "Escanear" a mano -- una ONU recién conectada en
   * campo podía quedar invisible en el panel hasta que alguien recordara
   * entrar y escanear esa OLT. Reutiliza el mismo método que el botón manual
   * (ya corregido para no pisar con un save() completo el status de una ONU
   * que se autorizó justo durante el escaneo, ver scanUnconfiguredOnus()) --
   * mismo patrón que handleScheduledMetricsPolling(): una OLT caída o un
   * fabricante sin `getUnconfiguredOnus()` implementado no debe abortar el
   * escaneo del resto.
   */
  @Cron('0 */15 * * * *')
  async handleScheduledOnuDiscovery(): Promise<void> {
    await this.tenantIterator.runForEachActiveTenant('onu-unconfigured-scan', async () => {
      const olts = await this.oltRepository.find({ where: { isActive: true } });
      if (olts.length === 0) return;

      this.logger.log(`Escaneo periódico de ONUs sin configurar para ${olts.length} OLT(s)...`);
      for (const olt of olts) {
        try {
          const discovered = await this.onuManagementService.scanUnconfiguredOnus(olt.id);
          this.logger.log(`[${olt.vendor}] OLT "${olt.name}": ${discovered.length} ONU(s) detectada(s) en el escaneo periódico.`);
        } catch (err: any) {
          this.logger.warn(`Escaneo periódico de ONUs falló para OLT "${olt.name}": ${err.message}`);
        }
      }
    });
  }

  /**
   * Lectura pasiva: devuelve el snapshot más reciente SIN disparar un poll
   * nuevo contra el equipo. Si todavía no existe ninguno para esta OLT, se
   * genera un primer snapshot real (mismo fallback que getMetricsHistory).
   * Úsalo para cargas de pantalla / aperturas de modal; el botón "Refrescar"
   * debe llamar a collectAndRecordMetrics() explícitamente.
   */
  async getLatestMetrics(oltId: string): Promise<OltMetricEntity> {
    const [latest] = await this.metricRepository.find({
      where: { oltId },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    if (latest) {
      return latest;
    }

    return this.collectAndRecordMetrics(oltId);
  }

  /**
   * Retorna el histórico de telemetría para las gráficas del frontend.
   */
  async getMetricsHistory(oltId: string, hours: number = 24): Promise<OltMetricEntity[]> {
    const since = new Date();
    since.setHours(since.getHours() - hours);

    const metrics = await this.metricRepository.find({
      where: { oltId, createdAt: MoreThanOrEqual(since) },
      order: { createdAt: 'ASC' },
    });

    // Si aún no hay snapshots persistidos, generar una muestra inicial
    if (metrics.length === 0) {
      const initial = await this.collectAndRecordMetrics(oltId);
      return [initial];
    }

    return metrics;
  }

  /**
   * Consulta el tráfico en tiempo real (Rx/Tx) de una interfaz o puerto PON en la OLT.
   */
  async getInterfaceRealtimeTraffic(oltId: string, interfaceName: string) {
    const olt = await this.oltRepository.findOneBy({ id: oltId });
    if (!olt) throw new NotFoundException(`OLT no encontrada: ${oltId}`);

    try {
      const driver = this.resolveDriver(olt);
      if (typeof driver.getInterfaceTraffic === 'function') {
        const connParams = await this.resolveOltConnectionParams(olt);
        const traffic = await driver.getInterfaceTraffic(connParams, interfaceName);
        return {
          interfaceName,
          rxKbps: traffic.rxKbps,
          txKbps: traffic.txKbps,
          timestamp: new Date().toISOString(),
        };
      }
    } catch (err: any) {
      this.logger.warn(`Error obteniendo tráfico de interfaz ${interfaceName} en OLT ${olt.name}: ${err.message}`);
    }

    return {
      interfaceName,
      rxKbps: 0,
      txKbps: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Envía una notificación a Telegram si el tenant tiene configurado el bot y chat.
   */
  async sendTelegramAlert(message: string): Promise<boolean> {
    try {
      const company = await this.companyProfileRepository.findOne({ where: {} });
      if (
        !company ||
        !company.telegramAlertsEnabled ||
        !company.telegramBotToken ||
        !company.telegramChatId
      ) {
        return false;
      }

      const url = `https://api.telegram.org/bot${company.telegramBotToken}/sendMessage`;
      await axios.post(url, {
        chat_id: company.telegramChatId,
        text: message,
        parse_mode: 'Markdown',
      });
      return true;
    } catch (err: any) {
      this.logger.warn(`[TELEGRAM-ALERT] Error enviando alerta: ${err.message}`);
      return false;
    }
  }

  /**
   * Envía una notificación de prueba para validar el bot y chat ID configurados.
   */
  async sendTestTelegramAlert(): Promise<{ success: boolean; message: string }> {
    const company = await this.companyProfileRepository.findOne({ where: {} });
    if (
      !company ||
      !company.telegramAlertsEnabled ||
      !company.telegramBotToken ||
      !company.telegramChatId
    ) {
      throw new BadRequestException(
        'Las alertas de Telegram no están habilitadas o falta configurar el token del bot y el chat ID en el perfil de la empresa.',
      );
    }

    const testMessage =
      `🧪 *Notificación de Prueba - NOC Sumtech*\n\n` +
      `• *Servicio:* Monitoreo y Telemetría de Red\n` +
      `• *Estado:* Canal de alertas por Telegram verificado con éxito\n` +
      `• *Fecha y hora:* ${new Date().toLocaleString()}\n\n` +
      `_Este canal recibirá alertas automáticas ante fallas de OLTs, caídas masivas de ONUs o umbrales críticos._`;

    const sent = await this.sendTelegramAlert(testMessage);
    if (!sent) {
      throw new BadRequestException('No se pudo enviar la alerta de prueba a Telegram. Verifique la validez del token y el chat ID.');
    }

    return {
      success: true,
      message: 'Alerta de prueba enviada exitosamente a Telegram.',
    };
  }
}
