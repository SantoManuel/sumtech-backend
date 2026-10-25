import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ReachabilityResolver } from './reachability-resolver.service';
import { RouterOsSshTransport } from '../transports/routeros-ssh.transport';
import { DeviceOperationLogger } from './device-operation-logger.service';
import { decryptCredential } from '../utils/crypto.util';
import { classifyDeviceError } from '../utils/device-error-classifier.util';
import { TransportConnectionTarget } from '../interfaces/routeros-transport.interface';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';

/** Los comandos de consola (backup, export, etc.) pueden tardar más que una simple lectura de métricas. */
const CONSOLE_TIMEOUT_MS = 15000;
/** Límite de caracteres guardados en el log por comando -- evita inflar net.device_log con salidas gigantes (ej. "/export"). */
const MAX_LOGGED_OUTPUT_CHARS = 5000;

/**
 * Consola RouterOS (acceso de shell real, sin restricciones, al router core)
 * -- SOLO rol ADMIN en el controller. Reusa `RouterOsSshTransport.query()`,
 * que ya existía y ya corre contra la flota real (antes solo para leer
 * `/system resource print`/`/system health print`), pero nunca se había
 * expuesto con un comando arbitrario del usuario. Cada comando se audita
 * completo vía DeviceOperationLogger con el `eventType: 'COMMAND'` que ya
 * existía reservado en DeviceLogEntity sin ningún llamador hasta ahora.
 */
@Injectable()
export class RouterConsoleService {
  private readonly logger = new Logger(RouterConsoleService.name);

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly reachabilityResolver: ReachabilityResolver,
    private readonly sshTransport: RouterOsSshTransport,
    private readonly operationLogger: DeviceOperationLogger,
  ) {}

  private getNodeRepository(): Repository<NetworkNodeEntity> {
    return this.tenantContext.getDataSource().getRepository(NetworkNodeEntity);
  }

  async runCommand(nodeId: string, rawCommand: string, actorUserId?: string): Promise<{ output: string }> {
    const command = rawCommand.trim();
    if (!command) {
      throw new BadRequestException('El comando no puede estar vacío.');
    }

    const repo = this.getNodeRepository();
    const node = await repo.findOne({ where: { id: nodeId } });
    if (!node) {
      throw new NotFoundException(`Nodo no encontrado: ${nodeId}`);
    }

    // SIEMPRE por SSH, sin importar el transportType configurado para
    // monitoreo del nodo (REST/ROUTEROS_API no exponen ejecución de comando
    // libre) -- se reusa el mismo host resuelto por método de conexión
    // (WireGuard/DDNS/IP pública), pero forzando el puerto/protocolo SSH.
    const resolved = await this.reachabilityResolver.resolveEndpoint(node);
    const password = node.apiPasswordEnc ? decryptCredential(node.apiPasswordEnc) : process.env.ROUTEROS_PASSWORD || '';
    const username = node.apiUser || process.env.ROUTEROS_USER || 'admin';

    const target: TransportConnectionTarget = {
      host: resolved.host,
      port: node.sshPort || 22,
      useHttps: false,
      username,
      password,
      timeoutMs: CONSOLE_TIMEOUT_MS,
    };

    try {
      const output = (await this.sshTransport.query(target, command)) || '';
      await this.operationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'SUCCESS',
        message: `Comando de consola ejecutado: ${command}`,
        actorUserId,
        rawDetails: { command, output: output.slice(0, MAX_LOGGED_OUTPUT_CHARS) },
      });
      return { output };
    } catch (error: any) {
      const classification = classifyDeviceError(error);
      this.logger.warn(`Comando de consola falló en nodo ${node.id} ("${command}"): ${classification.message}`);
      await this.operationLogger.logEvent({
        nodeId: node.id,
        eventType: 'COMMAND',
        status: 'FAILURE',
        errorCode: classification.code,
        message: `Comando de consola falló: ${command} -- ${classification.message}`,
        actorUserId,
        rawDetails: { command },
      });
      throw new BadRequestException(classification.message);
    }
  }
}
