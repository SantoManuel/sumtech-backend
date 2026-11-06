import { Injectable, Logger } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getJwtSecret } from '../../../common/utils/required-env.util';
import { getConfiguredCorsOrigins, isAllowedCorsOrigin } from '../../../common/utils/cors-origin.util';
import { TenantConnectionManagerService } from '../../../common/tenancy/tenant-connection-manager.service';
import { OltEntity } from '../entities/olt.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionParams, OltConsoleStream } from '../ports/olt-driver.port';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { decryptCredential } from '../../network-connectivity/utils/crypto.util';
import { withOltTelnetLock } from '../utils/olt-telnet-mutex';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_COMMAND_LENGTH = 2000;

interface ConsoleSession {
  stream: OltConsoleStream;
  oltId: string;
  oltName: string;
  actorUserId: string;
  idleTimer: NodeJS.Timeout;
  releaseLock: () => void;
}

/**
 * Consola OLT con streaming real (reemplaza el modelo de "un comando por
 * petición HTTP" de OltManagementService.runRawCommand -- cada llamada
 * abría/cerraba una sesión Telnet nueva, así que un comando que dependía de
 * contexto, ej. "configure terminal" seguido de "interface ...", no
 * funcionaba porque cada línea reconectaba desde el prompt raíz). Abre UNA
 * sesión Telnet por conexión de socket (ver IOltDriver.openConsoleStream),
 * viva mientras el modal esté abierto, y la mantiene serializada contra
 * withOltTelnetLock durante toda su vida -- no solo por comando -- para que
 * el cron de monitoreo/discovery no compita por el único canal Telnet del
 * equipo mientras el operador tiene la consola abierta. Mismo concepto que
 * RouterConsoleGateway, pero sobre Telnet crudo en vez de un shell SSH con
 * PTY.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws/olt-console',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      callback(null, isAllowedCorsOrigin(origin, getConfiguredCorsOrigins()));
    },
    credentials: true,
  },
})
export class OltConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(OltConsoleGateway.name);
  private readonly sessions = new Map<string, ConsoleSession>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantConnectionManager: TenantConnectionManagerService,
    private readonly driverRegistry: OltDriverRegistry,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly operationLogger: DeviceOperationLogger,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    let releaseLock: (() => void) | null = null;

    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) {
        throw new Error('Token de autorización no proporcionado.');
      }

      let payload: any;
      try {
        payload = this.jwtService.verify(token, { secret: getJwtSecret(this.configService) });
      } catch {
        throw new Error('Token inválido o expirado.');
      }

      if (!Array.isArray(payload.roles) || !payload.roles.includes('ADMIN')) {
        throw new Error('Solo el rol ADMIN puede usar la Consola OLT.');
      }

      if (!payload.tenantSlug || !payload.tenantId) {
        throw new Error('El token no tiene un tenant asociado.');
      }

      const tenant = await this.tenantConnectionManager.resolveTenantBySlug(payload.tenantSlug);
      if (!tenant || tenant.id !== payload.tenantId) {
        throw new Error('El token no corresponde a un tenant válido.');
      }

      const oltId = client.handshake.query?.oltId as string | undefined;
      if (!oltId) {
        throw new Error('Falta la OLT a conectar.');
      }

      const dataSource = await this.tenantConnectionManager.getDataSourceForTenant(tenant);
      const olt = await dataSource.getRepository(OltEntity).findOne({ where: { id: oltId } });
      if (!olt) {
        throw new Error(`OLT no encontrada: ${oltId}`);
      }

      const driver = this.driverRegistry.resolve(olt.vendor);
      if (typeof driver.openConsoleStream !== 'function') {
        throw new Error(`[${olt.vendor}] la Consola OLT todavía no está implementada para este fabricante.`);
      }

      const connParams = await this.resolveConnectionParams(olt, dataSource);

      // Espera su turno en la cola Telnet de esta OLT (olt-telnet-mutex) y
      // mantiene el lock tomado mientras dure la sesión completa -- se
      // libera recién en handleDisconnect(), no al terminar cada comando.
      releaseLock = await this.acquireTelnetLock(olt.id);

      const stream = await driver.openConsoleStream!(connParams);

      const session: ConsoleSession = {
        stream,
        oltId: olt.id,
        oltName: olt.name,
        actorUserId: payload.sub,
        idleTimer: this.scheduleIdleTimeout(client),
        releaseLock,
      };
      this.sessions.set(client.id, session);

      stream.onData((chunk: Buffer) => {
        client.emit('output', chunk.toString('ascii'));
        this.resetIdleTimeout(client);
      });

      client.emit('ready');

      await this.operationLogger.logEvent({
        nodeId: olt.viaNodeId || olt.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Sesión de consola OLT (streaming) iniciada en "${olt.name}".`,
        actorUserId: payload.sub,
      });
    } catch (err: any) {
      this.logger.warn(`Conexión de consola OLT rechazada: ${err.message}`);
      client.emit('error', err.message || 'No se pudo iniciar la sesión de consola.');
      releaseLock?.();
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const session = this.sessions.get(client.id);
    if (!session) return;

    clearTimeout(session.idleTimer);
    this.sessions.delete(client.id);

    session.stream
      .close()
      .catch(() => undefined)
      .finally(() => session.releaseLock());
  }

  @SubscribeMessage('command')
  handleCommand(@ConnectedSocket() client: Socket, @MessageBody() data: { text?: string }): void {
    const session = this.sessions.get(client.id);
    if (!session) return;

    const text = (data?.text ?? '').slice(0, MAX_COMMAND_LENGTH);
    // Siempre se reenvía (incluso vacío -- un Enter en blanco es normal en
    // una terminal real, solo refresca el prompt), pero solo se audita
    // cuando hay contenido real.
    session.stream.write(`${text}\r\n`);
    this.resetIdleTimeout(client);

    if (!text.trim()) return;

    this.operationLogger
      .logEvent({
        nodeId: session.oltId,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Comando de consola OLT (streaming) enviado a "${session.oltName}": ${text}`,
        actorUserId: session.actorUserId,
        rawDetails: { command: text },
      })
      .catch(() => undefined);
  }

  /** Ctrl+C -- interrumpe un comando en curso sin cerrar la sesión. */
  @SubscribeMessage('stop')
  handleStop(@ConnectedSocket() client: Socket): void {
    const session = this.sessions.get(client.id);
    if (!session) return;
    session.stream.write('\x03');
  }

  /**
   * Mismo criterio que OltConnectionResolverService.resolve(), reimplementado
   * acá porque ese servicio depende de un repositorio tenant-scoped
   * (NetworkNodeEntity vía TenantTypeOrmModule) cuyo contexto de
   * AsyncLocalStorage no sobrevive fuera de un request HTTP -- un socket de
   * WebSocket nunca pasa por TenantResolutionMiddleware. El DataSource del
   * tenant ya se resolvió a mano en handleConnection, así que se usa
   * directo.
   */
  private async resolveConnectionParams(olt: OltEntity, dataSource: DataSource): Promise<OltConnectionParams> {
    let host = olt.host;
    let port = olt.port || 23;

    if (olt.connectionMethod === 'VIA_MIKROTIK') {
      if (!olt.viaNodeId) {
        throw new Error(`La OLT "${olt.name}" usa VIA_MIKROTIK pero no tiene viaNodeId.`);
      }
      const node = await dataSource.getRepository(NetworkNodeEntity).findOneBy({ id: olt.viaNodeId });
      if (!node) {
        throw new Error('Router MikroTik asignado no encontrado.');
      }
      const endpoint = await this.reachabilityResolver.resolveEndpoint(node);
      host = endpoint.host;
      port = olt.natPort || 2323;
    }

    return {
      host,
      port,
      username: olt.username,
      password: decryptCredential(olt.passwordEnc),
      enablePassword: olt.enablePasswordEnc ? decryptCredential(olt.enablePasswordEnc) : undefined,
    };
  }

  /** Resuelve cuando le toca el turno en la cola Telnet de la OLT; devuelve la función para liberar el lock. */
  private acquireTelnetLock(oltId: string): Promise<() => void> {
    return new Promise((resolveTurn) => {
      withOltTelnetLock(oltId, () => {
        let release: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        resolveTurn(() => release());
        return held;
      }).catch(() => undefined);
    });
  }

  private scheduleIdleTimeout(client: Socket): NodeJS.Timeout {
    return setTimeout(() => {
      client.emit('ended', 'Sesión cerrada por inactividad.');
      client.disconnect(true);
    }, IDLE_TIMEOUT_MS);
  }

  private resetIdleTimeout(client: Socket): void {
    const session = this.sessions.get(client.id);
    if (!session) return;
    clearTimeout(session.idleTimer);
    session.idleTimer = this.scheduleIdleTimeout(client);
  }
}
