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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Client as SshClient, ClientChannel } from 'ssh2';
import { getJwtSecret } from '../../../common/utils/required-env.util';
import { getConfiguredCorsOrigins, isAllowedCorsOrigin } from '../../../common/utils/cors-origin.util';
import { TenantConnectionManagerService } from '../../../common/tenancy/tenant-connection-manager.service';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from '../services/reachability-resolver.service';
import { DeviceOperationLogger } from '../services/device-operation-logger.service';
import { decryptCredential } from '../utils/crypto.util';
import { classifyDeviceError } from '../utils/device-error-classifier.util';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_COMMAND_LENGTH = 2000;

interface ConsoleSession {
  sshClient: SshClient;
  shellStream: ClientChannel;
  nodeId: string;
  nodeName: string;
  actorUserId: string;
  idleTimer: NodeJS.Timeout;
}

/**
 * Consola RouterOS con streaming real (reemplaza el modelo de
 * "un comando por petición HTTP" de RouterConsoleService para comandos
 * interactivos tipo `/tool torch` o `/tool sniffer quick`, que nunca
 * terminan por sí solos y necesitan ver su salida en vivo + poder
 * interrumpirse con Ctrl+C). Abre UNA sesión SSH con PTY (`sshClient.shell()`)
 * por conexión de socket, viva mientras el modal esté abierto.
 *
 * El JWT (verificado acá, igual que AuthGuard) ya trae tenantId/tenantSlug/
 * roles -- no se usa TenantContextService (AsyncLocalStorage) porque su
 * contexto no sobrevive más allá del handshake HTTP inicial; el DataSource
 * del tenant se resuelve una sola vez en `handleConnection` y se guarda en la
 * sesión en memoria de este gateway.
 */
@Injectable()
@WebSocketGateway({
  namespace: '/ws/router-console',
  cors: {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      callback(null, isAllowedCorsOrigin(origin, getConfiguredCorsOrigins()));
    },
    credentials: true,
  },
})
export class RouterConsoleGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RouterConsoleGateway.name);
  private readonly sessions = new Map<string, ConsoleSession>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly tenantConnectionManager: TenantConnectionManagerService,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly operationLogger: DeviceOperationLogger,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
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
        throw new Error('Solo el rol ADMIN puede usar la Consola RouterOS.');
      }

      if (!payload.tenantSlug || !payload.tenantId) {
        throw new Error('El token no tiene un tenant asociado.');
      }

      const tenant = await this.tenantConnectionManager.resolveTenantBySlug(payload.tenantSlug);
      if (!tenant || tenant.id !== payload.tenantId) {
        throw new Error('El token no corresponde a un tenant válido.');
      }

      const nodeId = client.handshake.query?.nodeId as string | undefined;
      if (!nodeId) {
        throw new Error('Falta el nodo a conectar.');
      }

      const dataSource = await this.tenantConnectionManager.getDataSourceForTenant(tenant);
      const node = await dataSource.getRepository(NetworkNodeEntity).findOne({ where: { id: nodeId } });
      if (!node) {
        throw new Error(`Nodo no encontrado: ${nodeId}`);
      }

      const resolved = await this.reachabilityResolver.resolveEndpoint(node);
      const password = node.apiPasswordEnc ? decryptCredential(node.apiPasswordEnc) : process.env.ROUTEROS_PASSWORD || '';
      const username = node.apiUser || process.env.ROUTEROS_USER || 'admin';

      const sshClient = new SshClient();

      await new Promise<void>((resolve, reject) => {
        sshClient.once('ready', () => resolve());
        sshClient.once('error', (err) => reject(err));
        sshClient.connect({
          host: resolved.host,
          port: node.sshPort || 22,
          username,
          password,
          readyTimeout: 10000,
        });
      });

      const shellStream = await new Promise<ClientChannel>((resolve, reject) => {
        sshClient.shell({ term: 'xterm', rows: 30, cols: 120 }, (err, stream) => {
          if (err) return reject(err);
          resolve(stream);
        });
      });

      const session: ConsoleSession = {
        sshClient,
        shellStream,
        nodeId: node.id,
        nodeName: node.name,
        actorUserId: payload.sub,
        idleTimer: this.scheduleIdleTimeout(client),
      };
      this.sessions.set(client.id, session);

      shellStream.on('data', (chunk: Buffer) => {
        client.emit('output', chunk.toString('utf8'));
        this.resetIdleTimeout(client);
      });
      shellStream.stderr?.on('data', (chunk: Buffer) => {
        client.emit('output', chunk.toString('utf8'));
      });
      shellStream.on('close', () => {
        client.emit('ended', 'La sesión SSH se cerró.');
        client.disconnect(true);
      });
      sshClient.on('error', (err) => {
        const classification = classifyDeviceError(err);
        client.emit('error', classification.message);
      });

      client.emit('ready');

      await this.operationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Sesión de consola RouterOS (streaming) iniciada en nodo "${node.name}".`,
        actorUserId: payload.sub,
      });
    } catch (err: any) {
      this.logger.warn(`Conexión de consola RouterOS rechazada: ${err.message}`);
      client.emit('error', err.message || 'No se pudo iniciar la sesión de consola.');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const session = this.sessions.get(client.id);
    if (!session) return;

    clearTimeout(session.idleTimer);
    try {
      session.shellStream.end();
    } catch {
      // Ignorar -- la conexión ya pudo haberse caído del lado del router
    }
    try {
      session.sshClient.end();
    } catch {
      // Ignorar
    }
    this.sessions.delete(client.id);
  }

  @SubscribeMessage('command')
  handleCommand(@ConnectedSocket() client: Socket, @MessageBody() data: { text?: string }): void {
    const session = this.sessions.get(client.id);
    if (!session) return;

    const text = (data?.text ?? '').slice(0, MAX_COMMAND_LENGTH);
    // Siempre se reenvía (incluso vacío -- un Enter en blanco es normal en
    // una terminal real, solo refresca el prompt), pero solo se audita
    // cuando hay contenido real.
    session.shellStream.write(`${text}\r\n`);
    this.resetIdleTimeout(client);

    if (!text.trim()) return;

    this.operationLogger
      .logEvent({
        nodeId: session.nodeId,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Comando de consola (streaming) enviado a "${session.nodeName}": ${text}`,
        actorUserId: session.actorUserId,
        rawDetails: { command: text },
      })
      .catch(() => undefined);
  }

  /** Ctrl+C -- interrumpe un comando interactivo en curso (ej. /tool torch) sin cerrar la sesión. */
  @SubscribeMessage('stop')
  handleStop(@ConnectedSocket() client: Socket): void {
    const session = this.sessions.get(client.id);
    if (!session) return;
    session.shellStream.write('\x03');
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
