import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as net from 'net';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsClient } from '../../genieacs/genieacs-client';
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';
import { OnuManagementService } from './onu-management.service';

export interface CpeSessionPayload {
  onuId: string;
  serialNumber: string;
  targetIp: string;
  port: number;
  userId: string;
  defaultPath?: string;
}

export interface CpeCredentialsSuggestion {
  username: string;
  password: string;
  altUsername?: string;
  altPassword?: string;
  notes?: string;
}

export interface CpeWebSessionResult {
  success: boolean;
  targetIp: string;
  port: number;
  serialNumber: string;
  vendor: string;
  model: string;
  token: string;
  launchUrl: string;
  credentials: CpeCredentialsSuggestion;
}

@Injectable()
export class OnuWebProxyService {
  private readonly logger = new Logger(OnuWebProxyService.name);

  constructor(
    @InjectRepository(OnuEntity)
    private readonly onuRepository: Repository<OnuEntity>,
    @InjectRepository(OnuServiceConfigEntity)
    private readonly configRepository: Repository<OnuServiceConfigEntity>,
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly genieAcsClient: GenieAcsClient | null,
    private readonly genieAcsDeviceResolver: GenieAcsDeviceResolverService,
    private readonly onuManagementService: OnuManagementService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getJwtSecret(): string {
    return (
      this.configService.get<string>('JWT_SECRET') ||
      'sumtech_cpe_proxy_default_secret_key_2026'
    );
  }

  /**
   * Sugiere credenciales comunes de acceso web administrativo según fabricante
   */
  getSuggestedCredentials(vendor?: string, model?: string, serial?: string): CpeCredentialsSuggestion {
    const v = (vendor || '').toUpperCase();
    const s = (serial || '').toUpperCase();

    if (v.includes('HUAWEI') || s.startsWith('HWTC') || s.startsWith('CMDC')) {
      return {
        username: 'telecomadmin',
        password: 'admintelecom',
        altUsername: 'root',
        altPassword: 'admin',
        notes: 'Credencial súper-administrador Huawei / China Mobile.',
      };
    }

    if (v.includes('ZTE') || s.startsWith('ZTEG')) {
      return {
        username: 'admin',
        password: 'admin',
        altUsername: 'zte',
        altPassword: 'zte',
        notes: 'Credencial por defecto ZTE.',
      };
    }

    if (v.includes('FIBERHOME') || s.startsWith('FHTT')) {
      return {
        username: 'admin',
        password: 'admin',
        altUsername: 'useradmin',
        altPassword: 'useradmin',
        notes: 'Credencial por defecto FiberHome.',
      };
    }

    if (v.includes('VSOL')) {
      return {
        username: 'admin',
        password: 'admin',
        notes: 'Credencial por defecto V-SOL.',
      };
    }

    return {
      username: 'admin',
      password: 'admin',
      altUsername: 'telecomadmin',
      altPassword: 'admintelecom',
      notes: 'Credencial estándar de fabricante.',
    };
  }

  /**
   * Resuelve la IP de gestión de la ONU buscando primero una IP manual
   * asignada por el operador (serviceConfig.tr069Ip -- ver
   * setManualManagementIp): primero se pregunta EN VIVO a la OLT la IP que
   * la ONU ya obtuvo (OnuManagementService.resolveLiveManagementIp -- "show
   * gpon remote-onu ip-host"/"wan-ip", solo ZTE lo tiene implementado hoy),
   * sin que la ONU necesite haber contactado nunca a GenieACS. Si el
   * fabricante no soporta esa consulta (ej. Huawei, driver sin implementar
   * todavía) se cae a la IP manual que haya guardado el operador, luego a
   * GenieACS, y por último a la WAN estática configurada.
   */
  async resolveOnuIp(onu: OnuEntity): Promise<string> {
    const liveIp = await this.onuManagementService.resolveLiveManagementIp(onu.id);
    if (liveIp) {
      this.logger.log(`IP de gestión obtenida en vivo desde la OLT para ONU ${onu.serialNumber}: ${liveIp}`);
      return liveIp;
    }

    if (onu.serviceConfig?.tr069Ip) {
      return onu.serviceConfig.tr069Ip;
    }

    // 1. Intentar resolver deviceId de GenieACS
    let deviceId = onu.genieacsDeviceId;
    if (!deviceId && onu.contractId) {
      const resolved = await this.genieAcsDeviceResolver.findByContractId(onu.contractId);
      if (resolved?.genieacsDeviceId) {
        deviceId = resolved.genieacsDeviceId;
      }
    }

    if (deviceId && this.genieAcsClient) {
      try {
        const values = await this.genieAcsClient.getParameterValues(deviceId, [
          'InternetGatewayDevice.ManagementServer.ConnectionRequestURL',
          'Device.ManagementServer.ConnectionRequestURL',
          'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress',
        ]);

        const connReqUrl =
          values['InternetGatewayDevice.ManagementServer.ConnectionRequestURL'] ||
          values['Device.ManagementServer.ConnectionRequestURL'];

        if (connReqUrl) {
          try {
            const parsed = new URL(connReqUrl);
            if (parsed.hostname && parsed.hostname !== '127.0.0.1') {
              this.logger.log(`IP de gestión detectada vía ConnectionRequestURL: ${parsed.hostname}`);
              return parsed.hostname;
            }
          } catch {
            // URL malformada, seguir buscando
          }
        }

        const externalIp =
          values['InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.ExternalIPAddress'];
        if (externalIp && externalIp !== '0.0.0.0') {
          this.logger.log(`IP WAN detectada vía GenieACS ExternalIP: ${externalIp}`);
          return externalIp;
        }
      } catch (err: any) {
        this.logger.warn(`Error consultando IP en GenieACS para device ${deviceId}: ${err.message}`);
      }
    }

    // 2. Revisar WAN estática configurada
    if (onu.serviceConfig?.wanStaticIp) return onu.serviceConfig.wanStaticIp;

    const cfg = await this.configRepository.findOne({ where: { onuId: onu.id } });
    if (cfg?.tr069Ip) return cfg.tr069Ip;
    if (cfg?.wanStaticIp) return cfg.wanStaticIp;

    // 3. Probar si responde en las IPs de fábrica comunes (192.168.100.1 para Huawei, 192.168.1.1 para ZTE/otros)
    const vendorStr = (onu.vendor || onu.onuType?.vendor || '').toUpperCase();
    const serialStr = (onu.serialNumber || '').toUpperCase();
    const isHuawei = vendorStr.includes('HUAWEI') || serialStr.startsWith('HWTC') || serialStr.startsWith('CMDC');
    const primaryLanIp = isHuawei ? '192.168.100.1' : '192.168.1.1';
    const secondaryLanIp = isHuawei ? '192.168.1.1' : '192.168.100.1';

    const primaryOk = await this.checkPortConnectivity(primaryLanIp, 80, 800);
    if (primaryOk) {
      this.logger.log(`Conectividad detectada con la IP de fábrica primaria para ONU ${onu.serialNumber}: ${primaryLanIp}`);
      return primaryLanIp;
    }

    const secondaryOk = await this.checkPortConnectivity(secondaryLanIp, 80, 800);
    if (secondaryOk) {
      this.logger.log(`Conectividad detectada con la IP de fábrica secundaria para ONU ${onu.serialNumber}: ${secondaryLanIp}`);
      return secondaryLanIp;
    }

    throw new BadRequestException(
      `No se pudo determinar la dirección IP de gestión ni WAN para la ONU ${onu.serialNumber}. Asegúrese de que el equipo esté conectado a TR-069 o ingrese manualmente su IP (ej. 192.168.1.1 o 192.168.100.1).`,
    );
  }

  /**
   * Verifica conectividad TCP con el puerto de la ONU (timeout 1.5s)
   */
  async checkPortConnectivity(host: string, port = 80, timeoutMs = 1500): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(timeoutMs);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * Inicia una sesión temporal de acceso web remoto para la ONU.
   *
   * Si el operador ya conoce la IP de gestión (ej. la ONU nunca contactó a
   * GenieACS, o es un equipo detectedBy=OLT_IMPORT ya cableado en producción
   * por fuera de este sistema), `manualIp` la persiste en
   * serviceConfig.tr069Ip y la usa de inmediato -- no hace falta esperar a
   * que GenieACS resuelva algo que Sumtech ya sabe.
   */
  async createWebSession(onuId: string, userId: string, manualIp?: string): Promise<CpeWebSessionResult> {
    const onu = await this.onuRepository.findOne({
      where: { id: onuId },
      relations: ['serviceConfig', 'onuType'],
    });

    if (!onu) {
      throw new NotFoundException(`ONU con id ${onuId} no encontrada.`);
    }

    if (manualIp) {
      let config = onu.serviceConfig || (await this.configRepository.findOneBy({ onuId: onu.id }));
      if (!config) {
        config = this.configRepository.create({
          onuId: onu.id,
          managementMethod: 'TR069',
          operationMode: 'ROUTER',
        });
      }
      config.tr069Ip = manualIp;
      onu.serviceConfig = await this.configRepository.save(config);
      this.logger.log(`IP de gestión manual registrada por el operador para ONU ${onu.serialNumber}: ${manualIp}`);
    }

    const targetIp = await this.resolveOnuIp(onu);
    let port = 80;

    // Verificar si responde en puerto 80, o probar 8080 si falla
    const port80Ok = await this.checkPortConnectivity(targetIp, 80);
    if (port80Ok) {
      port = 80;
    } else {
      const port443Ok = await this.checkPortConnectivity(targetIp, 443);
      if (port443Ok) {
        port = 443;
      } else {
        const port8080Ok = await this.checkPortConnectivity(targetIp, 8080);
        if (port8080Ok) {
          port = 8080;
        } else {
          this.logger.warn(`[OnuWebProxy] Ni puerto 80, 443 ni 8080 respondieron en ${targetIp} (posible bloqueo WAN por firewall del CPE o falta de ruta VPN). Intentando por puerto 80.`);
        }
      }
    }

    const vendorStr = (onu.vendor || onu.onuType?.vendor || '').toUpperCase();
    const serialStr = (onu.serialNumber || '').toUpperCase();
    const isHuaweiOrCmdc =
      vendorStr.includes('HUAWEI') ||
      vendorStr.includes('CMDC') ||
      serialStr.startsWith('CMDC') ||
      serialStr.startsWith('HWTC');

    const defaultPath = isHuaweiOrCmdc ? '/webcmcc/index.html' : '/';

    const payload: CpeSessionPayload = {
      onuId: onu.id,
      serialNumber: onu.serialNumber,
      targetIp,
      port,
      userId,
      defaultPath,
    };

    const token = this.jwtService.sign(payload, {
      secret: this.getJwtSecret(),
      expiresIn: '2h',
    });

    const credentials = this.getSuggestedCredentials(
      onu.vendor || onu.onuType?.vendor,
      onu.model || onu.onuType?.model,
      onu.serialNumber,
    );

    return {
      success: true,
      targetIp,
      port,
      serialNumber: onu.serialNumber,
      vendor: onu.vendor || onu.onuType?.vendor || 'Genérico',
      model: onu.model || onu.onuType?.model || '',
      token,
      launchUrl: `/api/v1/olt/onus/web-proxy/launch?token=${encodeURIComponent(token)}`,
      credentials,
    };
  }

  /**
   * Valida un token de sesión CPE
   */
  verifySessionToken(token: string): CpeSessionPayload | null {
    try {
      return this.jwtService.verify<CpeSessionPayload>(token, {
        secret: this.getJwtSecret(),
      });
    } catch {
      return null;
    }
  }
}
