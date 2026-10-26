import { EventEmitter } from 'events';
import { RouterConsoleGateway } from './router-console.gateway';

jest.mock('ssh2', () => {
  return { Client: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client: MockSshClient } = require('ssh2');

class FakeShellChannel extends EventEmitter {
  stderr = new EventEmitter();
  write = jest.fn();
  end = jest.fn();
}

class FakeSshClient extends EventEmitter {
  connect = jest.fn();
  shell = jest.fn();
  end = jest.fn();
}

function makeFakeClientSocket(overrides: Partial<{ auth: any; query: any }> = {}) {
  return {
    id: 'socket-1',
    handshake: {
      auth: overrides.auth ?? { token: 'valid-token' },
      query: overrides.query ?? { nodeId: 'node-1' },
    },
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

describe('RouterConsoleGateway', () => {
  let gateway: RouterConsoleGateway;
  let jwtService: any;
  let configService: any;
  let tenantConnectionManager: any;
  let reachabilityResolver: any;
  let operationLogger: any;
  let fakeSshClient: FakeSshClient;
  let fakeShellChannel: FakeShellChannel;

  const validPayload = { sub: 'user-1', roles: ['ADMIN'], tenantId: 'tenant-1', tenantSlug: 'sumtech' };
  const mockTenant = { id: 'tenant-1', slug: 'sumtech' };
  const mockNode = {
    id: 'node-1',
    name: 'Nodo_Tabara_Abajo',
    sshPort: 2322,
    apiUser: 'admin',
    apiPasswordEnc: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    fakeShellChannel = new FakeShellChannel();
    fakeSshClient = new FakeSshClient();
    fakeSshClient.shell.mockImplementation((_opts: any, cb: any) => cb(null, fakeShellChannel));
    fakeSshClient.connect.mockImplementation(() => {
      process.nextTick(() => fakeSshClient.emit('ready'));
    });
    (MockSshClient as jest.Mock).mockImplementation(() => fakeSshClient);

    jwtService = { verify: jest.fn().mockReturnValue(validPayload) };
    configService = { get: jest.fn().mockReturnValue('test-jwt-secret') };
    tenantConnectionManager = {
      resolveTenantBySlug: jest.fn().mockResolvedValue(mockTenant),
      getDataSourceForTenant: jest.fn().mockResolvedValue({
        getRepository: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(mockNode) }),
      }),
    };
    reachabilityResolver = {
      resolveEndpoint: jest.fn().mockResolvedValue({ host: '10.254.2.2', port: 443, useHttps: false }),
    };
    operationLogger = { logEvent: jest.fn().mockResolvedValue(undefined) };

    gateway = new RouterConsoleGateway(
      jwtService,
      configService,
      tenantConnectionManager,
      reachabilityResolver,
      operationLogger,
    );
  });

  afterEach(() => {
    // Limpia cualquier sesión activa (y su idleTimer) para no dejar timers colgados entre tests
    (gateway as any).sessions.forEach((s: any) => clearTimeout(s.idleTimer));
    (gateway as any).sessions.clear();
  });

  describe('handleConnection', () => {
    it('rechaza y desconecta si no se manda token', async () => {
      const client = makeFakeClientSocket({ auth: {} });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('Token'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(fakeSshClient.connect).not.toHaveBeenCalled();
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

    it('rechaza si falta nodeId en el query del handshake', async () => {
      const client = makeFakeClientSocket({ query: {} });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('nodo'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('rechaza si el nodo no existe en la base del tenant', async () => {
      tenantConnectionManager.getDataSourceForTenant.mockResolvedValue({
        getRepository: jest.fn().mockReturnValue({ findOne: jest.fn().mockResolvedValue(null) }),
      });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('error', expect.stringContaining('Nodo no encontrado'));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('en éxito: siempre fuerza puerto/protocolo SSH, abre shell PTY y emite "ready"', async () => {
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(fakeSshClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.254.2.2', port: 2322, username: 'admin' }),
      );
      expect(fakeSshClient.shell).toHaveBeenCalledWith(expect.objectContaining({ term: 'xterm' }), expect.any(Function));
      expect(client.emit).toHaveBeenCalledWith('ready');
      expect(operationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: 'node-1', eventType: 'COMMAND', status: 'SUCCESS' }),
      );
    });

    it('reenvía al cliente cada chunk de salida del shell como evento "output"', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      fakeShellChannel.emit('data', Buffer.from('comment=test\n'));

      expect(client.emit).toHaveBeenCalledWith('output', 'comment=test\n');
    });

    it('si el SSH falla al conectar, emite error clasificado y desconecta', async () => {
      fakeSshClient.connect.mockImplementation(() => {
        process.nextTick(() => fakeSshClient.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })));
      });
      const client = makeFakeClientSocket();

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('handleCommand', () => {
    it('no hace nada si no hay sesión activa para ese socket', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleCommand(client, { text: '/interface print' })).not.toThrow();
      expect(fakeShellChannel.write).not.toHaveBeenCalled();
    });

    it('escribe el comando con CRLF en el shell y audita cuando hay contenido', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleCommand(client, { text: '/interface print' });

      expect(fakeShellChannel.write).toHaveBeenCalledWith('/interface print\r\n');
      expect(operationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ rawDetails: { command: '/interface print' } }),
      );
    });

    it('un Enter en blanco se reenvía al shell pero no se audita', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);
      operationLogger.logEvent.mockClear();

      gateway.handleCommand(client, { text: '   ' });

      expect(fakeShellChannel.write).toHaveBeenCalledWith('   \r\n');
      expect(operationLogger.logEvent).not.toHaveBeenCalled();
    });
  });

  describe('handleStop (Ctrl+C)', () => {
    it('escribe el byte 0x03 en el shell para interrumpir un comando en curso', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleStop(client);

      expect(fakeShellChannel.write).toHaveBeenCalledWith('\x03');
    });

    it('no hace nada si no hay sesión activa', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleStop(client)).not.toThrow();
    });
  });

  describe('handleDisconnect', () => {
    it('cierra el canal del shell y la conexión SSH, y limpia la sesión', async () => {
      const client = makeFakeClientSocket();
      await gateway.handleConnection(client);

      gateway.handleDisconnect(client);

      expect(fakeShellChannel.end).toHaveBeenCalled();
      expect(fakeSshClient.end).toHaveBeenCalled();
      expect((gateway as any).sessions.has(client.id)).toBe(false);
    });

    it('no lanza si se llama sin una sesión activa (desconexión antes de terminar el login)', () => {
      const client = makeFakeClientSocket();
      expect(() => gateway.handleDisconnect(client)).not.toThrow();
    });
  });
});
