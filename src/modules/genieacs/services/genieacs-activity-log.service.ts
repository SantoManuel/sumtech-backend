import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { GENIEACS_CLIENT } from '../genieacs-client-factory';
import { GenieAcsClient } from '../genieacs-client';
import { GenieAcsActivityLogEntry } from '../dto/onu-tr069-snapshot.dto';

const TASK_FAULT_ID_PATTERN = /:task_(.+)$/;

/**
 * "Device Logs" (§3.16 del plan) reinterpretado honestamente: TR-069 no
 * tiene un RPC estándar para bajar el log interno del CPE -- lo que esto
 * muestra es la actividad real del lado de GenieACS (qué tareas se le
 * mandaron al equipo y si el equipo las rechazó), reusando las colecciones
 * `/tasks` y `/faults` que la NBI ya expone.
 */
@Injectable()
export class GenieAcsActivityLogService {
  constructor(
    @Optional()
    @Inject(GENIEACS_CLIENT)
    private readonly client: GenieAcsClient | null,
  ) {}

  private getClient(): GenieAcsClient {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'El servidor GenieACS no está configurado (falta GENIEACS_NBI_BASE_URL o GENIEACS_NBI_API_KEY).',
      );
    }
    return this.client;
  }

  async getActivityLog(deviceId: string, limit = 50): Promise<GenieAcsActivityLogEntry[]> {
    const client = this.getClient();
    const [tasks, faults] = await Promise.all([client.getDeviceTasks(deviceId, limit), client.getDeviceFaults(deviceId, limit)]);

    const faultByTaskId = new Map<string, any>();
    for (const fault of faults) {
      const match = TASK_FAULT_ID_PATTERN.exec(fault?._id || '');
      if (match) {
        faultByTaskId.set(match[1], fault);
      }
    }

    const taskEntries: GenieAcsActivityLogEntry[] = tasks.map((task, index) => {
      const taskId = task?._id;
      const matchedFault = taskId ? faultByTaskId.get(taskId) : undefined;
      return {
        id: taskId || `task-${index}`,
        timestamp: task?.timestamp,
        type: 'TASK',
        name: task?.name || 'Tarea',
        outcome: matchedFault ? 'FAULT' : 'OK',
        detail: matchedFault?.message,
      };
    });

    // Faults que no corresponden a ninguna de las tareas consultadas (ej.
    // quedaron fuera del `limit`, o no vienen de un SetParameterValues) --
    // igual son actividad real del equipo, se muestran como entrada propia.
    const visibleTaskIds = new Set(tasks.map((t) => t?._id).filter(Boolean));
    const standaloneFaultEntries: GenieAcsActivityLogEntry[] = faults
      .filter((fault) => {
        const match = TASK_FAULT_ID_PATTERN.exec(fault?._id || '');
        return !match || !visibleTaskIds.has(match[1]);
      })
      .map((fault, index) => ({
        id: fault?._id || `fault-${index}`,
        timestamp: fault?.timestamp,
        type: 'FAULT' as const,
        name: fault?.channel || 'Fault',
        outcome: 'FAULT' as const,
        detail: fault?.message,
      }));

    return [...taskEntries, ...standaloneFaultEntries].sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });
  }
}
