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
import * as http from 'http';
import { Request, Response } from 'express';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsClient } from '../../genieacs/genieacs-client';
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';

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
   * Resuelve la IP de gestión de la ONU buscando en GenieACS, config de servicio o mgmtIp
   */
  async resolveOnuIp(onu: OnuEntity): Promise<string> {
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

    // 2. Revisar configuración de servicio
    if (onu.serviceConfig) {
      if (onu.serviceConfig.tr069Ip) return onu.serviceConfig.tr069Ip;
      if (onu.serviceConfig.wanStaticIp) return onu.serviceConfig.wanStaticIp;
    }

    const cfg = await this.configRepository.findOne({ where: { onuId: onu.id } });
    if (cfg?.tr069Ip) return cfg.tr069Ip;
    if (cfg?.wanStaticIp) return cfg.wanStaticIp;

    throw new BadRequestException(
      `No se pudo determinar la dirección IP de gestión ni WAN para la ONU ${onu.serialNumber}. Asegúrese de que el equipo esté conectado a TR-069 o tenga IP asignada.`,
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
   * Inicia una sesión temporal de acceso web remoto para la ONU
   */
  async createWebSession(onuId: string, userId: string): Promise<CpeWebSessionResult> {
    const onu = await this.onuRepository.findOne({
      where: { id: onuId },
      relations: ['serviceConfig', 'onuType'],
    });

    if (!onu) {
      throw new NotFoundException(`ONU con id ${onuId} no encontrada.`);
    }

    const targetIp = await this.resolveOnuIp(onu);
    let port = 80;

    // Verificar si responde en puerto 80, o probar 8080 si falla
    const port80Ok = await this.checkPortConnectivity(targetIp, 80);
    if (!port80Ok) {
      const port8080Ok = await this.checkPortConnectivity(targetIp, 8080);
      if (port8080Ok) {
        port = 8080;
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

  /**
   * Reenvía una petición HTTP hacia la ONU eliminando headers restrictivos de iframes
   * y preservando cookies de sesión y tokens en redirecciones.
   */
  proxyHttpRequest(
    req: Request,
    res: Response,
    targetIp: string,
    port: number,
    sessionToken?: string,
  ) {
    const cleanHeaders: http.OutgoingHttpHeaders = { ...req.headers };
    cleanHeaders['host'] = `${targetIp}:${port}`;
    delete cleanHeaders['connection'];

    // Si viene la cookie sumtech_cpe_token, no se la enviamos a la ONU para no confundir su firmware
    if (cleanHeaders['cookie'] && typeof cleanHeaders['cookie'] === 'string') {
      cleanHeaders['cookie'] = cleanHeaders['cookie']
        .replace(/sumtech_cpe_token=[^;]+;?\s*/g, '')
        .trim();
    }

    // Limpiar query params de token antes de enviar la ruta a la ONU
    let targetPath = req.url;
    if (sessionToken && targetPath.includes('token=')) {
      try {
        const dummyUrl = new URL(`http://dummy${req.url}`);
        dummyUrl.searchParams.delete('token');
        dummyUrl.searchParams.delete('sumtech_cpe_token');
        dummyUrl.searchParams.delete('cpe_token');
        targetPath = dummyUrl.pathname + (dummyUrl.search ? dummyUrl.search : '');
      } catch {
        targetPath = req.url;
      }
    }

    const options: http.RequestOptions = {
      hostname: targetIp,
      port: port,
      path: targetPath,
      method: req.method,
      headers: cleanHeaders,
      timeout: 15000,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const responseHeaders: http.OutgoingHttpHeaders = { ...proxyRes.headers };

      // Eliminar encabezados de seguridad que prohíben incrustar en un iframe
      delete responseHeaders['x-frame-options'];
      delete responseHeaders['content-security-policy'];
      delete responseHeaders['X-Frame-Options'];
      delete responseHeaders['Content-Security-Policy'];

      // Reescribir Location si la ONU redirige hacia su IP local fija (ej. http://192.168.1.1/...)
      if (responseHeaders['location'] && typeof responseHeaders['location'] === 'string') {
        const loc = responseHeaders['location'];
        try {
          const parsed = new URL(loc);
          const searchParams = new URLSearchParams(parsed.search);
          if (sessionToken && !searchParams.has('token') && !searchParams.has('sumtech_cpe_token')) {
            searchParams.set('token', sessionToken);
          }
          const qs = searchParams.toString();
          responseHeaders['location'] = parsed.pathname + (qs ? `?${qs}` : '');
        } catch {
          // Si ya era relativo ej: /webcmcc/login.html
          if (sessionToken && !loc.includes('token=')) {
            const separator = loc.includes('?') ? '&' : '?';
            responseHeaders['location'] = `${loc}${separator}token=${encodeURIComponent(sessionToken)}`;
          }
        }
      }

      // Preservar cualquier encabezado previamente fijado en res (ej: Set-Cookie de Express)
      const existingHeaders = res.getHeaders();
      for (const [key, value] of Object.entries(existingHeaders)) {
        if (value !== undefined) {
          if (key.toLowerCase() === 'set-cookie') {
            const incoming = responseHeaders['set-cookie'];
            const currentArr = Array.isArray(value) ? value.map(String) : [String(value)];
            const incomingArr = incoming
              ? Array.isArray(incoming)
                ? incoming.map(String)
                : [String(incoming)]
              : [];
            responseHeaders['set-cookie'] = [...currentArr, ...incomingArr];
          } else if (!responseHeaders[key]) {
            responseHeaders[key] = value as any;
          }
        }
      }

      res.writeHead(proxyRes.statusCode || 200, responseHeaders);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      this.logger.error(`Error reenviando petición a la ONU ${targetIp}:${port} -> ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send(`
          <html>
            <body style="background:#0f172a;color:#f87171;font-family:sans-serif;padding:24px;text-align:center;">
              <h2>No se pudo conectar a la interfaz web de la ONU</h2>
              <p>Destino: <code>${targetIp}:${port}</code></p>
              <p>Detalle: ${err.message}</p>
            </body>
          </html>
        `);
      }
    });

    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.status(504).send(`
          <html>
            <body style="background:#0f172a;color:#f87171;font-family:sans-serif;padding:24px;text-align:center;">
              <h2>Tiempo de espera agotado al conectar con la ONU</h2>
              <p>El equipo en <code>${targetIp}:${port}</code> no respondió a tiempo.</p>
            </body>
          </html>
        `);
      }
    });

    if (req.body && Object.keys(req.body).length > 0) {
      let bodyData: any;
      const contentType = String(cleanHeaders['content-type'] || '');
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        bodyData = req.body;
      } else if (contentType.includes('application/json')) {
        bodyData = JSON.stringify(req.body);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        bodyData = new URLSearchParams(req.body as any).toString();
      } else {
        bodyData = JSON.stringify(req.body);
      }
      cleanHeaders['content-length'] = Buffer.byteLength(bodyData);
      proxyReq.write(bodyData);
      proxyReq.end();
    } else {
      req.pipe(proxyReq);
    }
  }
}
