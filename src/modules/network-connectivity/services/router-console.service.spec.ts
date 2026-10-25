import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RouterConsoleService } from './router-console.service';

describe('RouterConsoleService', () => {
  let mockNodeRepo: { findOne: jest.Mock };
  let mockTenantContext: { getDataSource: jest.Mock };
  let mockReachabilityResolver: { resolveEndpoint: jest.Mock };
  let mockSshTransport: { query: jest.Mock };
  let mockOperationLogger: { logEvent: jest.Mock };

  const mockNode = {
    id: 'node-1',
    sshPort: 22,
    apiUser: 'admin',
    apiPasswordEnc: undefined,
  };

  beforeEach(() => {
    mockNodeRepo = { findOne: jest.fn().mockResolvedValue(mockNode) };
    mockTenantContext = { getDataSource: jest.fn().mockReturnValue({ getRepository: jest.fn().mockReturnValue(mockNodeRepo) }) };
    mockReachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.254.2.2', port: 443, useHttps: true, resolvedVia: 'WIREGUARD' }),
    };
    mockSshTransport = { query: jest.fn() };
    mockOperationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };
  });

  const makeService = () =>
    new RouterConsoleService(
      mockTenantContext as any,
      mockReachabilityResolver as any,
      mockSshTransport as any,
      mockOperationLogger as any,
    );

  it('lanza BadRequestException si el comando está vacío (o solo espacios), sin tocar el router', async () => {
    await expect(makeService().runCommand('node-1', '   ', 'user-1')).rejects.toThrow(BadRequestException);
    expect(mockSshTransport.query).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si el nodo no existe', async () => {
    mockNodeRepo.findOne.mockResolvedValue(null);

    await expect(makeService().runCommand('node-inexistente', '/system resource print', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('siempre usa el puerto/protocolo SSH (sshPort, sin HTTPS) sin importar qué puerto resolvió reachabilityResolver para REST', async () => {
    mockSshTransport.query.mockResolvedValue('comment=test');

    await makeService().runCommand('node-1', '/system identity print', 'user-1');

    expect(mockSshTransport.query).toHaveBeenCalledWith(
      expect.objectContaining({ host: '10.254.2.2', port: 22, useHttps: false, username: 'admin' }),
      '/system identity print',
    );
  });

  it('recorta espacios del comando antes de ejecutarlo y de auditarlo', async () => {
    mockSshTransport.query.mockResolvedValue('ok');

    await makeService().runCommand('node-1', '  /ping 8.8.8.8 count=1  ', 'user-1');

    expect(mockSshTransport.query).toHaveBeenCalledWith(expect.anything(), '/ping 8.8.8.8 count=1');
  });

  it('en éxito, devuelve la salida real y audita eventType COMMAND con status SUCCESS', async () => {
    mockSshTransport.query.mockResolvedValue(' 0   name="Nodo_Tabara_Abajo"\n');

    const result = await makeService().runCommand('node-1', '/system identity print', 'user-1');

    expect(result).toEqual({ output: ' 0   name="Nodo_Tabara_Abajo"\n' });
    expect(mockOperationLogger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        eventType: 'COMMAND',
        status: 'SUCCESS',
        actorUserId: 'user-1',
        rawDetails: expect.objectContaining({ command: '/system identity print' }),
      }),
    );
  });

  it('si el router rechaza el comando, lanza BadRequestException y audita eventType COMMAND con status FAILURE (nunca oculta el fallo)', async () => {
    mockSshTransport.query.mockRejectedValue(new Error('syntax error (line 1 column 5)'));

    await expect(makeService().runCommand('node-1', '/invalid-command', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(mockOperationLogger.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 'node-1', eventType: 'COMMAND', status: 'FAILURE', actorUserId: 'user-1' }),
    );
  });

  it('nunca guarda más de 5000 caracteres de salida en el log de auditoría (evita inflar net.device_log con un "/export" gigante)', async () => {
    const hugeOutput = 'x'.repeat(10000);
    mockSshTransport.query.mockResolvedValue(hugeOutput);

    await makeService().runCommand('node-1', '/export', 'user-1');

    const loggedCall = mockOperationLogger.logEvent.mock.calls[0][0];
    expect((loggedCall.rawDetails.output as string).length).toBe(5000);
  });
});
