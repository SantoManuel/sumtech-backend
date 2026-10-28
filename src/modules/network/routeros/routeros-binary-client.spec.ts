import { BadRequestException } from '@nestjs/common';
import { RouterOsBinaryClient } from './routeros-binary-client';

const mockConnect = jest.fn();
const mockWrite = jest.fn();
const mockClose = jest.fn();

jest.mock('node-routeros', () => ({
  RouterOSAPI: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    write: mockWrite,
    close: mockClose,
  })),
}));

describe('RouterOsBinaryClient', () => {
  let client: RouterOsBinaryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConnect.mockResolvedValue(undefined);
    mockClose.mockResolvedValue(undefined);
    client = new RouterOsBinaryClient({
      managementIp: '10.254.1.12',
      apiPort: 8728,
      username: 'erp-admin',
      password: 'secret',
    });
  });

  describe('ciclo de vida de la conexión', () => {
    it('conecta y cierra el socket incluso si la operación fue exitosa', async () => {
      mockWrite.mockResolvedValue([]);
      await client.getInterfaces();
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('cierra el socket incluso si la operación falló', async () => {
      mockWrite.mockRejectedValue(new Error('boom'));
      await expect(client.getInterfaces()).rejects.toThrow();
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it('no revienta si el cierre del socket en sí falla', async () => {
      mockWrite.mockResolvedValue([]);
      mockClose.mockRejectedValue(new Error('socket ya cerrado'));
      await expect(client.getInterfaces()).resolves.toEqual([]);
    });

    it('usa el timeout configurado en segundos, redondeando hacia arriba', async () => {
      const { RouterOSAPI } = require('node-routeros');
      mockWrite.mockResolvedValue([]);
      client = new RouterOsBinaryClient({
        managementIp: '10.254.1.12',
        apiPort: 8728,
        username: 'erp-admin',
        password: 'secret',
        timeoutMs: 2500,
      });
      await client.getInterfaces();
      expect(RouterOSAPI).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.254.1.12', port: 8728, user: 'erp-admin', password: 'secret', timeout: 3 }),
      );
    });

    it('usa el default de 8s si no se especifica timeoutMs', async () => {
      const { RouterOSAPI } = require('node-routeros');
      mockWrite.mockResolvedValue([]);
      await client.getInterfaces();
      expect(RouterOSAPI).toHaveBeenCalledWith(expect.objectContaining({ timeout: 8 }));
    });
  });

  describe('describeError (mapeo de errores de conexión a mensajes legibles)', () => {
    it('reporta timeout de forma legible', async () => {
      mockConnect.mockRejectedValue(new Error('connection timeout'));
      await expect(client.getInterfaces()).rejects.toThrow(/tiempo de espera agotado/i);
    });

    it('reporta conexión rechazada de forma legible', async () => {
      mockConnect.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      await expect(client.getInterfaces()).rejects.toThrow(/conexión rechazada/i);
    });

    it('reporta reset de conexión sugiriendo revisar el puerto', async () => {
      mockConnect.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
      await expect(client.getInterfaces()).rejects.toThrow(/puerto configurado/i);
    });

    it('reporta el mensaje crudo de un error de RouterOS (RosException) si no matchea ningún patrón conocido', async () => {
      mockConnect.mockRejectedValue(Object.assign(new Error('no such item'), { errno: 'NOSUCHITEM' }));
      await expect(client.getInterfaces()).rejects.toThrow(/no such item/i);
    });

    it('cae a un mensaje genérico si el error no tiene message', async () => {
      mockConnect.mockRejectedValue({});
      await expect(client.getInterfaces()).rejects.toThrow(/error desconocido/i);
    });
  });

  describe('testConnection', () => {
    it('devuelve ok:true si el nodo responde', async () => {
      mockWrite.mockResolvedValue([{ name: 'MikroTik' }]);
      const result = await client.testConnection();
      expect(result).toEqual({ ok: true });
      expect(mockWrite).toHaveBeenCalledWith('/system/identity/print');
    });

    it('devuelve ok:false con un mensaje legible si falla la conexión', async () => {
      mockConnect.mockRejectedValue(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }));
      const result = await client.testConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/conexión rechazada/i);
    });
  });

  describe('getInterfaces (Lote A)', () => {
    it('mapea las interfaces físicas desde /interface/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          name: 'ether1',
          type: 'ether',
          running: 'true',
          disabled: 'false',
          'mac-address': 'AA:BB:CC:DD:EE:FF',
          mtu: '1500',
          comment: 'WAN',
        },
        { '.id': '*2', name: 'ether2', type: 'ether', running: 'false', disabled: 'true' },
      ]);

      const result = await client.getInterfaces();

      expect(mockWrite).toHaveBeenCalledWith('/interface/print');
      expect(result).toEqual([
        {
          id: '*1',
          name: 'ether1',
          type: 'ether',
          running: true,
          disabled: false,
          macAddress: 'AA:BB:CC:DD:EE:FF',
          mtu: 1500,
          comment: 'WAN',
        },
        {
          id: '*2',
          name: 'ether2',
          type: 'ether',
          running: false,
          disabled: true,
          macAddress: undefined,
          mtu: undefined,
          comment: undefined,
        },
      ]);
    });

    it('devuelve lista vacía si el router no tiene interfaces o la respuesta no es un arreglo', async () => {
      mockWrite.mockResolvedValue(undefined);
      await expect(client.getInterfaces()).resolves.toEqual([]);
    });
  });

  describe('getIpPools (Lote A)', () => {
    it('mapea los pools desde /ip/pool/print', async () => {
      mockWrite.mockResolvedValue([
        { '.id': '*1', name: 'pool-clientes', ranges: '10.20.0.10-10.20.0.250', 'next-pool': 'pool-overflow' },
      ]);

      const result = await client.getIpPools();

      expect(mockWrite).toHaveBeenCalledWith('/ip/pool/print');
      expect(result).toEqual([
        { id: '*1', name: 'pool-clientes', ranges: '10.20.0.10-10.20.0.250', nextPool: 'pool-overflow' },
      ]);
    });
  });

  describe('getUsedPoolAddresses (Lote A)', () => {
    it('filtra por el pool pedido y extrae solo la IP (sin la máscara)', async () => {
      mockWrite.mockResolvedValue([{ address: '10.20.0.15/32' }, { address: '10.20.0.16/32' }]);

      const result = await client.getUsedPoolAddresses('pool-clientes');

      expect(mockWrite).toHaveBeenCalledWith('/ip/pool/used/print', ['?pool=pool-clientes']);
      expect(result).toEqual(['10.20.0.15', '10.20.0.16']);
    });

    it('descarta entradas sin address', async () => {
      mockWrite.mockResolvedValue([{ address: '10.20.0.15/32' }, { foo: 'bar' }]);
      const result = await client.getUsedPoolAddresses('pool-clientes');
      expect(result).toEqual(['10.20.0.15']);
    });
  });

  describe('getPppSecrets (Lote A)', () => {
    it('mapea los secrets PPP desde /ppp/secret/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          name: 'cliente1',
          disabled: 'false',
          profile: 'Sumtech-20Mbps',
          service: 'pppoe',
          'remote-address': '10.20.0.15',
          comment: 'contrato-123',
        },
      ]);

      const result = await client.getPppSecrets();

      expect(mockWrite).toHaveBeenCalledWith('/ppp/secret/print');
      expect(result).toEqual([
        {
          id: '*1',
          name: 'cliente1',
          disabled: false,
          profile: 'Sumtech-20Mbps',
          service: 'pppoe',
          remoteAddress: '10.20.0.15',
          comment: 'contrato-123',
        },
      ]);
    });
  });

  describe('getActiveSessions (Lote A)', () => {
    it('mapea las sesiones activas desde /ppp/active/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          name: 'cliente1',
          service: 'pppoe',
          'caller-id': 'AA:BB:CC:DD:EE:FF',
          address: '10.20.0.15',
          uptime: '1h2m3s',
          encoding: 'MPPE128',
          'session-id': '0x1',
        },
      ]);

      const result = await client.getActiveSessions();

      expect(mockWrite).toHaveBeenCalledWith('/ppp/active/print');
      expect(result).toEqual([
        {
          id: '*1',
          name: 'cliente1',
          service: 'pppoe',
          callerId: 'AA:BB:CC:DD:EE:FF',
          address: '10.20.0.15',
          uptime: '1h2m3s',
          encoding: 'MPPE128',
          sessionId: '0x1',
        },
      ]);
    });
  });

  describe('getProfiles (Lote A)', () => {
    it('mapea los perfiles PPP desde /ppp/profile/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          name: 'Sumtech-20Mbps',
          'rate-limit': '20M/20M',
          'parent-queue': 'Total-Bandwidth',
          'local-address': '10.20.0.1',
          'remote-address': 'pool-clientes',
          'only-one': 'yes',
          'dns-server': '8.8.8.8,1.1.1.1',
        },
      ]);

      const result = await client.getProfiles();

      expect(mockWrite).toHaveBeenCalledWith('/ppp/profile/print');
      expect(result).toEqual([
        {
          id: '*1',
          name: 'Sumtech-20Mbps',
          rateLimit: '20M/20M',
          parentQueue: 'Total-Bandwidth',
          localAddress: '10.20.0.1',
          remoteAddress: 'pool-clientes',
          onlyOne: true,
          dnsServer: '8.8.8.8,1.1.1.1',
        },
      ]);
    });

    it('deja onlyOne en undefined si el router no lo reporta', async () => {
      mockWrite.mockResolvedValue([{ '.id': '*1', name: 'default' }]);
      const result = await client.getProfiles();
      expect(result[0].onlyOne).toBeUndefined();
    });
  });

  describe('getDhcpLeases (Lote A)', () => {
    it('mapea las leases DHCP desde /ip/dhcp-server/lease/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          address: '10.20.0.20',
          'mac-address': 'AA:BB:CC:DD:EE:01',
          server: 'dhcp-vlan400',
          'host-name': 'ont-cliente1',
          dynamic: 'true',
          disabled: 'false',
          comment: 'contrato-123',
          'last-seen': '2m3s',
        },
      ]);

      const result = await client.getDhcpLeases();

      expect(mockWrite).toHaveBeenCalledWith('/ip/dhcp-server/lease/print');
      expect(result).toEqual([
        {
          id: '*1',
          address: '10.20.0.20',
          macAddress: 'AA:BB:CC:DD:EE:01',
          server: 'dhcp-vlan400',
          hostName: 'ont-cliente1',
          status: 'bound',
          dynamic: true,
          disabled: false,
          comment: 'contrato-123',
          lastSeen: '2m3s',
        },
      ]);
    });

    it('usa "static" como status por defecto para una lease no dinámica sin status explícito', async () => {
      mockWrite.mockResolvedValue([{ address: '10.20.0.21', dynamic: 'false' }]);
      const result = await client.getDhcpLeases();
      expect(result[0].status).toBe('static');
    });
  });

  describe('getSimpleQueues (Lote A)', () => {
    it('mapea las colas simples desde /queue/simple/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          name: 'cliente1',
          target: '10.20.0.15/32',
          'max-limit': '20M/20M',
          rate: '5M/5M',
          bytes: '1000/2000',
          packets: '10/20',
          disabled: 'false',
          comment: 'contrato-123',
        },
      ]);

      const result = await client.getSimpleQueues();

      expect(mockWrite).toHaveBeenCalledWith('/queue/simple/print');
      expect(result).toEqual([
        {
          id: '*1',
          name: 'cliente1',
          target: '10.20.0.15/32',
          maxLimit: '20M/20M',
          rate: '5M/5M',
          bytes: '1000/2000',
          packets: '10/20',
          disabled: false,
          comment: 'contrato-123',
        },
      ]);
    });
  });

  describe('listVlanInterfaces (Lote A)', () => {
    it('mapea las sub-interfaces VLAN desde /interface/vlan/print', async () => {
      mockWrite.mockResolvedValue([{ '.id': '*1', name: 'vlan400', 'vlan-id': '400', interface: 'ether5' }]);

      const result = await client.listVlanInterfaces();

      expect(mockWrite).toHaveBeenCalledWith('/interface/vlan/print');
      expect(result).toEqual([{ id: '*1', name: 'vlan400', vlanId: 400, interface: 'ether5' }]);
    });
  });

  describe('getIpAddresses (Lote A)', () => {
    it('mapea las IPs configuradas desde /ip/address/print', async () => {
      mockWrite.mockResolvedValue([
        { '.id': '*1', address: '10.20.0.1/24', interface: 'vlan400', comment: 'Gateway VLAN 400' },
      ]);

      const result = await client.getIpAddresses();

      expect(mockWrite).toHaveBeenCalledWith('/ip/address/print');
      expect(result).toEqual([{ id: '*1', address: '10.20.0.1/24', interface: 'vlan400', comment: 'Gateway VLAN 400' }]);
    });
  });

  describe('listDhcpServers (Lote A)', () => {
    it('mapea los servidores DHCP desde /ip/dhcp-server/print', async () => {
      mockWrite.mockResolvedValue([
        { '.id': '*1', name: 'dhcp-vlan400', interface: 'vlan400', 'address-pool': 'pool-clientes', disabled: 'false' },
      ]);

      const result = await client.listDhcpServers();

      expect(mockWrite).toHaveBeenCalledWith('/ip/dhcp-server/print');
      expect(result).toEqual([
        { id: '*1', name: 'dhcp-vlan400', interface: 'vlan400', addressPool: 'pool-clientes', disabled: false },
      ]);
    });
  });

  describe('listPppoeServers (Lote A)', () => {
    it('mapea los servidores PPPoE desde /interface/pppoe-server/server/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          'service-name': 'pppoe-vlan400',
          interface: 'vlan400',
          'default-profile': 'default',
          disabled: 'false',
          'one-session-per-host': 'yes',
          authentication: 'mschap2',
        },
      ]);

      const result = await client.listPppoeServers();

      expect(mockWrite).toHaveBeenCalledWith('/interface/pppoe-server/server/print');
      expect(result).toEqual([
        {
          id: '*1',
          serviceName: 'pppoe-vlan400',
          interface: 'vlan400',
          defaultProfile: 'default',
          disabled: false,
          oneSessionPerHost: true,
          authentication: 'mschap2',
        },
      ]);
    });

    it('cae a "default" como perfil y usa el name si no hay service-name', async () => {
      mockWrite.mockResolvedValue([{ '.id': '*1', name: 'server1', interface: 'vlan400' }]);
      const result = await client.listPppoeServers();
      expect(result[0].serviceName).toBe('server1');
      expect(result[0].defaultProfile).toBe('default');
    });
  });

  describe('listNatRules (Lote A)', () => {
    it('mapea las reglas NAT desde /ip/firewall/nat/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          chain: 'srcnat',
          action: 'masquerade',
          'out-interface': 'ether1',
          comment: 'sumtech-nat-masquerade',
          disabled: 'false',
        },
      ]);

      const result = await client.listNatRules();

      expect(mockWrite).toHaveBeenCalledWith('/ip/firewall/nat/print');
      expect(result).toEqual([
        { id: '*1', chain: 'srcnat', action: 'masquerade', outInterface: 'ether1', comment: 'sumtech-nat-masquerade', disabled: false },
      ]);
    });
  });

  describe('listFilterRules (Lote A)', () => {
    it('mapea las reglas de filter desde /ip/firewall/filter/print', async () => {
      mockWrite.mockResolvedValue([
        {
          '.id': '*1',
          chain: 'input',
          action: 'accept',
          'connection-state': 'established,related',
          comment: 'sumtech-established',
          disabled: 'false',
        },
      ]);

      const result = await client.listFilterRules();

      expect(mockWrite).toHaveBeenCalledWith('/ip/firewall/filter/print');
      expect(result).toEqual([
        { id: '*1', chain: 'input', action: 'accept', connectionState: 'established,related', comment: 'sumtech-established', disabled: false },
      ]);
    });
  });

  describe('getRouterLogs (Lote A)', () => {
    it('pide /log/print sin filtro cuando no se pasa topics, y devuelve los últimos 150 en orden invertido', async () => {
      mockWrite.mockResolvedValue([
        { '.id': '*1', time: '10:00:00', topics: 'system,info', message: 'primero' },
        { '.id': '*2', time: '10:00:01', topics: 'system,info', message: 'segundo' },
      ]);

      const result = await client.getRouterLogs();

      expect(mockWrite).toHaveBeenCalledWith('/log/print', []);
      expect(result).toEqual([
        { id: '*2', time: '10:00:01', topics: 'system,info', message: 'segundo' },
        { id: '*1', time: '10:00:00', topics: 'system,info', message: 'primero' },
      ]);
    });

    it('filtra por topics cuando se pasa', async () => {
      mockWrite.mockResolvedValue([]);
      await client.getRouterLogs('error');
      expect(mockWrite).toHaveBeenCalledWith('/log/print', ['?topics=error']);
    });

    it('recorta a los últimos 150 registros', async () => {
      const entries = Array.from({ length: 200 }, (_, i) => ({ '.id': `*${i}`, time: 't', topics: 'x', message: `m${i}` }));
      mockWrite.mockResolvedValue(entries);
      const result = await client.getRouterLogs();
      expect(result).toHaveLength(150);
      expect(result[0].message).toBe('m199');
    });
  });

  describe('operaciones Lote B/C (todavía no soportadas por este transporte)', () => {
    const unsupportedMethods = [
      'findPppSecretByName',
      'createPppSecret',
      'ensurePppSecret',
      'setPppSecretDisabled',
      'setPppSecretProfile',
      'findProfileByName',
      'createProfile',
      'updateProfile',
      'ensureProfile',
      'ensureSuspensionProfile',
      'deleteProfile',
      'findActiveSessionByName',
      'killActiveSession',
      'addAddressListEntry',
      'removeAddressListEntry',
      'addFirewallNatRule',
      'addFirewallFilterRule',
      'findVlanInterfaceByVlanId',
      'ensureVlanInterface',
      'findIpAddressByInterface',
      'ensureIpAddress',
      'removeIpAddress',
      'removeVlanInterface',
      'findDhcpClientByInterface',
      'ensureDhcpClient',
      'findPppoeClientByName',
      'ensurePppoeClient',
      'findRouteByDestination',
      'ensureDefaultRoute',
      'ensureNatMasquerade',
      'findNatRuleByComment',
      'ensureFirewallBaseline',
      'findFilterRuleByComment',
      'findIpPoolByName',
      'ensureIpPool',
      'findDhcpServerNetworkByAddress',
      'ensureDhcpServerNetwork',
      'findDhcpServerByInterface',
      'ensureDhcpServer',
      'findStaticLeaseByMac',
      'ensureStaticLease',
      'setLeaseDisabled',
      'findSimpleQueueByName',
      'ensureSimpleQueue',
      'setSimpleQueueDisabled',
      'ensureAcsAutoProvisioning',
      'findPppoeServerByInterface',
      'ensurePppoeServer',
      'createBackup',
      'exportConfig',
      'readFileChunks',
      'deleteFile',
      'checkPackageUpdates',
      'setInterfaceDisabled',
      'createIpPool',
      'updateIpPool',
      'deleteIpPool',
      'makeDhcpLeaseStatic',
      'deleteDhcpLease',
      'ensureAddressListEntry',
      'removeAddressListEntriesByComment',
      'removeFilterRulesByComment',
    ] as const;

    it.each(unsupportedMethods)('%s lanza BadRequestException sin intentar conectar al router', async (methodName) => {
      await expect((client as any)[methodName]()).rejects.toThrow(BadRequestException);
      await expect((client as any)[methodName]()).rejects.toThrow(new RegExp(methodName));
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('cubre exactamente los 62 métodos de Lote B/C definidos en el plan (ni de más ni de menos)', () => {
      expect(unsupportedMethods).toHaveLength(62);
    });
  });
});
