import { OltConsoleGateway } from './olt-console.gateway';

function makeFakeClientSocket(overrides: Partial<{ auth: any; query: any; id: string }> = {}) {
  return {
    id: overrides.id ?? 'socket-1',
    handshake: {
      auth: overrides.auth ?? { token: 'valid-token' },
      query: overrides.query ?? { oltId: 'olt-1' },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('OltConsoleGateway', () => {
  let gateway: OltConsoleGateway;
  let jwtService: any;
  let configService: any;
  let tenantConnectionManager: any;
  let driverRegistry: any;
  let reachabilityResolver: any;
  let operationLogger: any;
  let fakeDriver: any;
  let fakeStream: any;
  let streamOnDataCb: ((chunk: Buffer) => void) | null;

  const validPayload = { sub: 'user-1', roles: ['ADMIN'], tenantId: 'tenant-1', tenantSlug: 'sumtech' };
  const mockTenant = { id: 'tenant-1', slug: 'sumtech' };
  const mockOlt = {
    id: 'olt-1',
    name: 'OLT_Tabara_Abajo',
    vendor: 'ZTE',
    host: '10.0.0.1',
    port: 23,
    connectionMethod: 'DIRECT',
    username: 'admin',
    passwordEnc: 'enc:pass',
    enablePasswordEnc: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    streamOnDataCb = null;

    fakeStream = {
      write: jest.fn(),
      onData: jest.fn((cb: (chunk: Buffer) => void) => {
        streamOnDataCb = cb;
      }),
      close: jest.fn().mockResolvedValue(undefined),
    };

    fakeDriver = {
      openConsoleStream: jest.fn().mockResolvedValue(fakeStream),
    };

    jwtService = { verify: jest.fn().mockReturnValue(validPayload) };
    configService = { get: jest.fn().mockReturnValue('test-jwt-secret') };
    tenantConnectionManager = {
      resolveTenantBySlug: jest.fn().mockResolvedValue(mockTenant),
      getDataSourceForTenant: jest.fn().mockResolvedValue({
        getRepository: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(mockOlt) }),
      }),
    };
    driverRegistry = { resolve: jest.fn().mockReturnValue(fakeDriver) };
    reachabilityResolver = { resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.254.2.2' }) };
    operationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };

    gateway = new OltConsoleGateway(
      jwtService,
      configService,
      tenantConnectionManager,
      driverRegistry,
      reachabilityResolver,
      operationLogger,
    );
  });

  afterEach(() => {
    // Libera cualquier lock Telnet tomado y limpia idleTimers, para que una
    // sesión de un test no bloquee la cola Telnet (olt-telnet-mutex, estado
    // a nivel de módulo) del siguiente test que use la misma oltId.
    (gateway as any).sessions.forEach((s: any) => {
      clearTimeout(s.idleTimer);
      s.releaseLock();
    });
    (gateway as any).sessions.clear();
  });

  describe('handleConnection', () => {
    it('rechaza y desconecta si no se manda token', async () => {
      const client = makeFakeClientSocket({ auth: {} });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('Token'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(fakeDriver.openConsoleStream).not.toHaveBeenCalled();
    });

    it('rechaza si el JWT es inválido', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', 'Token inválido o expirado.');
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si el rol no incluye ADMIN', async () => {
      jwtService.verify.mockReturnValue({ ...validPayload, roles: ['GERENTE'] });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('ADMIN'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si el tenant del token no coincide con el tenant resuelto', async () => {
      tenantConnectionManager.resolveTenantBySlug.mockResolvedValue({ id: 'otro-tenant', slug: 'sumtech' });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('tenant'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si falta oltId en el query del handshake', async () => {
      const client = makeFakeClientSocket({ query: {} });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('OLT a conectar'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si la OLT no existe en la base del tenant', async () => {
      tenantConnectionManager.getDataSourceForTenant.mockResolvedValue({
        getRepository: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }),
      });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('OLT no encontrada'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si el driver del fabricante no implementa openConsoleStream', async () => {
      driverRegistry.resolve.mockReturnValue({});
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('todavía no está implementada'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('resuelve host/puerto por MikroTik (VIA_MIKROTIK) antes de abrir el stream', async () => {
      tenantConnectionManager.getDataSourceForTenant.mockResolvedValue({
        getRepository: jest.fn((entity: any) => ({
          findOne: jest.fn().mockResolvedValue({ ...mockOlt, connectionMethod: 'VIA_MIKROTIK', viaNodeId: 'node-1' }),
          findOneBy: jest.fn().mockResolvedValue({ id: 'node-1' }),
        })),
      });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(reachabilityResolver.resolveEndpoint).toHaveBeenCalled();
      expect(fakeDriver.openConsoleStream).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.254.2.2' }),
      );
    });

    it('en éxito: abre el stream del driver, reenvía su salida y emite "ready"', async () => {
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(fakeDriver.openConsoleStream).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.1', port: 23, username: 'admin' }),
      );
      expect(client.emit).toHaveBeenCalledWith('ready');
      expect(operationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'olt-1', eventType: 'COMMAND', status: 'SUCCESS' }),
      );

      streamOnDataCb?.(Buffer.from('V2.1.0\n'));
      expect(client.emit).toHaveBeenCalledWith('output', 'V2.1.0\n');
    });

    it('si el driver falla al abrir la sesión Telnet, emite error y desconecta', async () => {
      fakeDriver.openConsoleStream.mockRejectedValue(new Error('Timeout de conexión Telnet'));
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('Timeout'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleCommand', () => {
    it('no hace nada si no hay sesión activa para ese socket', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleCommand(client, { text: 'show version' })).not.toThrow();
      expect(fakeStream.write).not.toHaveBeenCalled();
    });

    it('escribe el comando con CRLF en el stream y audita cuando hay contenido', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleCommand(client, { text: 'show version' });

      expect(fakeStream.write).toHaveBeenCalledWith('show version\r\n');
      expect(operationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ rawDetails: { command: 'show version' } }),
      );
    });

    it('un Enter en blanco se reenvía al stream pero no se audita', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);
      operationLogger.logEvent.mockClear();

      gateway.handleCommand(client, { text: '   ' });

      expect(fakeStream.write).toHaveBeenCalledWith('   \r\n');
      expect(operationLogger.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('handleStop (Ctrl+C)', () => {
    it('escribe el byte 0x03 en el stream para interrumpir un comando en curso', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleStop(client);

      expect(fakeStream.write).toHaveBeenCalledWith('\x03');
    });

    it('no hace nada si no hay sesión activa', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleStop(client)).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('cierra el stream Telnet del driver y limpia la sesión', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleDisconnect(client);
      await Promise.resolve();

      expect(fakeStream.close).toHaveBeenCalled();
      expect((gateway as any).sessions.has(client.id)).toBe(false);
    });

    it('no lanza si se llama sin una sesión activa (desconexión antes de terminar la conexión)', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleDisconnect(client)).not.toThrow();
    });

    it('libera la cola Telnet de la OLT: una segunda conexión a la misma OLT espera hasta que la primera se desconecte', async () => {
      const first = makeFakeClientSocket({ id: 'socket-1' });
      await gateway.handleConnection(first);
      expect(fakeDriver.openConsoleStream).toHaveBeenCalledTimes(1);

      let secondResolved = false;
      const second = makeFakeClientSocket({ id: 'socket-2' });
      const secondConnection = gateway.handleConnection(second).then(() => {
        secondResolved = true;
      });

      // Todavía no debería haber podido tomar su turno en la cola Telnet.
      await Promise.resolve();
      await Promise.resolve();
      expect(secondResolved).toBe(false);

      gateway.handleDisconnect(first);

      await secondConnection;
      expect(secondResolved).toBe(true);
      expect(fakeDriver.openConsoleStream).toHaveBeenCalledTimes(2);
    });
  });
});
