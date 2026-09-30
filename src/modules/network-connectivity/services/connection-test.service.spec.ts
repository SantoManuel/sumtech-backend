import { ConnectionTestService } from './connection-test.service';

describe('ConnectionTestService', () => {
  let service: ConnectionTestService;
  let reachabilityResolver: any;
  let restTransport: any;
  let binaryTransport: any;
  let sshTransport: any;

  beforeEach(() => {
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({
        host: '192.168.88.1',
        port: 443,
        useHttps: true,
        resolvedVia: 'DIRECT',
      }),
    };

    restTransport = {
      testConnection: jest.fn().mockResolvedValue({
        success: true,
        latencyMs: 10,
        version: '7.14.3',
        boardName: 'CHR',
      }),
    };

    binaryTransport = {
      testConnection: jest.fn().mockResolvedValue({
        success: true,
        latencyMs: 15,
        version: '6.49.10',
        boardName: 'CCR1009',
      }),
    };

    sshTransport = {
      testConnection: jest.fn().mockResolvedValue({
        success: true,
        latencyMs: 30,
        version: '7.12',
      }),
    };

    service = new ConnectionTestService(
      reachabilityResolver,
      restTransport,
      binaryTransport,
      sshTransport,
    );
  });

  it('debe realizar exitosamente el test REST contra RouterOS v7', async () => {
    const res = await service.executePreflight({
      host: '192.168.88.1',
      port: 443,
      useHttps: true,
      transportType: 'REST',
    });

    expect(res.success).toBe(true);
    expect(res.detectedVersion).toBe('7.14.3');
    expect(res.recommendedTransport).toBe('REST');
    expect(restTransport.testConnection).toHaveBeenCalled();
  });

  it('debe realizar fallback automático a API binaria cuando REST falla (ej. RouterOS v6)', async () => {
    restTransport.testConnection.mockResolvedValueOnce({
      success: false,
      latencyMs: 8,
      errorMessage: 'Not Found / 404',
    });

    const res = await service.executePreflight({
      host: '192.168.88.1',
      port: 443,
      useHttps: true,
      transportType: 'REST',
    });

    expect(res.success).toBe(true);
    expect(res.detectedVersion).toBe('6.49.10');
    expect(res.recommendedTransport).toBe('ROUTEROS_API');
    expect(binaryTransport.testConnection).toHaveBeenCalled();
  });

  it('debe devolver error descriptivo si no se provee host ni IP', async () => {
    const res = await service.executePreflight({});
    expect(res.success).toBe(false);
    expect(res.errorMessage).toContain('Se requiere una dirección IP');
  });
});
