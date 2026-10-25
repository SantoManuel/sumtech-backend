import { ServiceUnavailableException } from '@nestjs/common';
import { GenieAcsActivityLogService } from './genieacs-activity-log.service';

describe('GenieAcsActivityLogService', () => {
  let mockClient: { getDeviceTasks: jest.Mock; getDeviceFaults: jest.Mock };

  beforeEach(() => {
    mockClient = { getDeviceTasks: jest.fn(), getDeviceFaults: jest.fn() };
  });

  it('lanza ServiceUnavailableException si GenieACS no está configurado', async () => {
    const service = new GenieAcsActivityLogService(null);

    await expect(service.getActivityLog('DEV-01')).rejects.toThrow(ServiceUnavailableException);
  });

  it('marca una tarea como FAULT y arrastra el mensaje del fault real cuando existe uno correlacionado', async () => {
    mockClient.getDeviceTasks.mockResolvedValue([
      { _id: 'task-1', name: 'setParameterValues', timestamp: '2026-10-25T10:00:00Z' },
    ]);
    mockClient.getDeviceFaults.mockResolvedValue([
      { _id: 'DEV-01:task_task-1', message: 'Invalid parameter value', timestamp: '2026-10-25T10:00:01Z' },
    ]);

    const service = new GenieAcsActivityLogService(mockClient as any);
    const log = await service.getActivityLog('DEV-01');

    expect(log).toEqual([
      {
        id: 'task-1',
        timestamp: '2026-10-25T10:00:00Z',
        type: 'TASK',
        name: 'setParameterValues',
        outcome: 'FAULT',
        detail: 'Invalid parameter value',
      },
    ]);
  });

  it('una tarea sin fault correlacionado se marca OK', async () => {
    mockClient.getDeviceTasks.mockResolvedValue([{ _id: 'task-2', name: 'reboot', timestamp: '2026-10-25T10:00:00Z' }]);
    mockClient.getDeviceFaults.mockResolvedValue([]);

    const service = new GenieAcsActivityLogService(mockClient as any);
    const log = await service.getActivityLog('DEV-01');

    expect(log[0].outcome).toBe('OK');
    expect(log[0].detail).toBeUndefined();
  });

  it('un fault sin tarea visible (ej. fuera del límite consultado) aparece como entrada propia', async () => {
    mockClient.getDeviceTasks.mockResolvedValue([]);
    mockClient.getDeviceFaults.mockResolvedValue([
      { _id: 'DEV-01:task_old-task', message: 'Timeout', channel: 'task_old-task', timestamp: '2026-10-20T00:00:00Z' },
    ]);

    const service = new GenieAcsActivityLogService(mockClient as any);
    const log = await service.getActivityLog('DEV-01');

    expect(log).toEqual([
      {
        id: 'DEV-01:task_old-task',
        timestamp: '2026-10-20T00:00:00Z',
        type: 'FAULT',
        name: 'task_old-task',
        outcome: 'FAULT',
        detail: 'Timeout',
      },
    ]);
  });

  it('ordena de más reciente a más antiguo combinando tareas y faults', async () => {
    mockClient.getDeviceTasks.mockResolvedValue([
      { _id: 'task-old', name: 'reboot', timestamp: '2026-10-01T00:00:00Z' },
      { _id: 'task-new', name: 'reboot', timestamp: '2026-10-25T00:00:00Z' },
    ]);
    mockClient.getDeviceFaults.mockResolvedValue([]);

    const service = new GenieAcsActivityLogService(mockClient as any);
    const log = await service.getActivityLog('DEV-01');

    expect(log.map((e) => e.id)).toEqual(['task-new', 'task-old']);
  });

  it('una tarea/fault sin timestamp no rompe el ordenamiento (se trata como la más antigua)', async () => {
    mockClient.getDeviceTasks.mockResolvedValue([
      { _id: 'task-sin-fecha', name: 'reboot' },
      { _id: 'task-con-fecha', name: 'reboot', timestamp: '2026-10-25T00:00:00Z' },
    ]);
    mockClient.getDeviceFaults.mockResolvedValue([]);

    const service = new GenieAcsActivityLogService(mockClient as any);
    const log = await service.getActivityLog('DEV-01');

    expect(log.map((e) => e.id)).toEqual(['task-con-fecha', 'task-sin-fecha']);
  });
});
