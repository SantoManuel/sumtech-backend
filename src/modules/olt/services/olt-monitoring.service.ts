import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThanOrEqual } from 'typeorm';
import axios from 'axios';
import { OltEntity } from '../entities/olt.entity';
import { OltMetricEntity } from '../entities/olt-metric.entity';
import { OnuEntity } from '../entities/onu.entity';
import { CompanyProfileEntity } from '../../company/entities/company-profile.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import {
  IOltDriver,
  OltConnectionParams,
  UnknownOltVendorError,
} from '../ports/olt-driver.port';

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

    let cardsInfo: OltMetricEntity['cardsInfo'] = [];
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

    // Alarmas reales: sin fuente implementada todavía para ningún fabricante
    // (HiOSO tiene `show log (flash|ram) (critical|...)` como pista real sin
    // reconocimiento aún; ZTE sin investigar) — nunca fabricar una a partir
    // de otro dato simulado.
    const alarmsInfo: OltMetricEntity['alarmsInfo'] = [];

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

    // Limpieza de métricas con más de 30 días de antigüedad
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    await this.metricRepository.delete({
      createdAt: LessThan(thirtyDaysAgo),
    });

    return saved;
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
}
