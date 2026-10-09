import { RouterOsClient } from './routeros-client';

describe('RouterOsClient', () => {
  let http: { get: jest.Mock; put: jest.Mock; patch: jest.Mock; delete: jest.Mock };
  let client: RouterOsClient;

  beforeEach(() => {
    http = { get: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() };
    client = new RouterOsClient(
      { managementIp: '10.10.0.1', apiPort: 8729, username: 'api-readonly', password: 'secret' },
      http,
    );
  });

  describe('testConnection', () => {
    it('llama a /rest/system/identity con Basic Auth y devuelve ok:true si el nodo responde', async () => {
      http.get.mockResolvedValue({ data: { name: 'RB-Las-Yayas' } });

      const result = await client.testConnection();

      expect(result).toEqual({ ok: true });
      expect(http.get).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/system/identity',
        expect.objectContaining({
          headers: { Authorization: `Basic ${Buffer.from('api-readonly:secret').toString('base64')}` },
          timeout: 5000,
        }),
      );
    });

    it('usa http en vez de https cuando useHttps=false', async () => {
      const plainClient = new RouterOsClient(
        { managementIp: '10.10.0.1', apiPort: 80, username: 'api', password: 'secret', useHttps: false },
        http,
      );
      http.get.mockResolvedValue({ data: {} });

      await plainClient.testConnection();

      expect(http.get).toHaveBeenCalledWith('http://10.10.0.1:80/rest/system/identity', expect.anything());
    });

    it('devuelve ok:false con un motivo legible si el nodo no responde (sin respuesta de red)', async () => {
      http.get.mockRejectedValue({ request: {} });

      const result = await client.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/no se pudo contactar/i);
    });

    it('devuelve ok:false con el código de estado si el nodo respondió con un error HTTP', async () => {
      http.get.mockRejectedValue({ response: { status: 401, data: { detail: 'invalid credentials' } } });

      const result = await client.testConnection();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('401');
    });

    it('devuelve ok:false con un motivo de timeout si la petición se agota', async () => {
      http.get.mockRejectedValue({ code: 'ECONNABORTED' });

      const result = await client.testConnection();

      expect(result.error).toMatch(/tiempo de espera/i);
    });
  });

  describe('findPppSecretByName', () => {
    it('busca por query param "name", captura el .id de RouterOS y normaliza disabled cuando llega como boolean', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*1', name: 't1@tecmas', disabled: true, profile: 'default', service: 'pppoe' }],
      });

      const secret = await client.findPppSecretByName('t1@tecmas');

      expect(secret).toEqual({ id: '*1', name: 't1@tecmas', disabled: true, profile: 'default', service: 'pppoe' });
      expect(http.get).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/secret',
        expect.objectContaining({ params: { name: 't1@tecmas' } }),
      );
    });

    it('normaliza disabled cuando el nodo lo devuelve como el string "true"/"false" (API legada)', async () => {
      http.get.mockResolvedValue({ data: [{ name: 't1@tecmas', disabled: 'false' }] });

      const secret = await client.findPppSecretByName('t1@tecmas');

      expect(secret?.disabled).toBe(false);
    });

    it('devuelve null (no es un error) si el nodo no tiene ningún secreto con ese nombre', async () => {
      http.get.mockResolvedValue({ data: [] });

      const secret = await client.findPppSecretByName('inexistente');

      expect(secret).toBeNull();
    });

    it('lanza un error legible si la petición falla', async () => {
      http.get.mockRejectedValue({ response: { status: 401, data: { detail: 'invalid credentials' } } });

      await expect(client.findPppSecretByName('t1@tecmas')).rejects.toThrow(/401/);
    });
  });

  describe('setPppSecretDisabled', () => {
    it('hace PATCH sobre el .id del secreto con disabled="true" al deshabilitar', async () => {
      http.patch.mockResolvedValue({ data: {} });

      await client.setPppSecretDisabled('*1', true);

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/secret/*1',
        { disabled: 'true' },
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') }) }),
      );
    });

    it('hace PATCH con disabled="false" al habilitar', async () => {
      http.patch.mockResolvedValue({ data: {} });

      await client.setPppSecretDisabled('*1', false);

      expect(http.patch).toHaveBeenCalledWith(expect.anything(), { disabled: 'false' }, expect.anything());
    });

    it('lanza un error legible si el PATCH falla', async () => {
      http.patch.mockRejectedValue({ response: { status: 403, data: { detail: 'not permitted' } } });

      await expect(client.setPppSecretDisabled('*1', true)).rejects.toThrow(/403/);
    });
  });

  describe('setPppSecretProfile', () => {
    it('hace PATCH sobre el .id del secreto asignando el perfil nuevo', async () => {
      http.patch.mockResolvedValue({ data: {} });

      await client.setPppSecretProfile('*1', 'Sumtech-50Mbps');

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/secret/*1',
        { profile: 'Sumtech-50Mbps' },
        expect.anything(),
      );
    });

    it('lanza un error legible si el PATCH falla', async () => {
      http.patch.mockRejectedValue({ response: { status: 404, data: { detail: 'no such item' } } });

      await expect(client.setPppSecretProfile('*1', 'Sumtech-50Mbps')).rejects.toThrow(/404/);
    });
  });

  describe('findProfileByName', () => {
    it('busca por query param "name" y captura el .id y el rate-limit', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*5', name: 'Sumtech-50Mbps', 'rate-limit': '50M/50M' }] });

      const profile = await client.findProfileByName('Sumtech-50Mbps');

      expect(profile).toEqual({ id: '*5', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      expect(http.get).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile',
        expect.objectContaining({ params: { name: 'Sumtech-50Mbps' } }),
      );
    });

    it('devuelve null (no es un error) si el nodo no tiene ningún perfil con ese nombre', async () => {
      http.get.mockResolvedValue({ data: [] });

      const profile = await client.findProfileByName('Sumtech-999Mbps');

      expect(profile).toBeNull();
    });

    it('lanza un error legible si la petición falla', async () => {
      http.get.mockRejectedValue({ response: { status: 401, data: {} } });

      await expect(client.findProfileByName('Sumtech-50Mbps')).rejects.toThrow(/401/);
    });
  });

  describe('createProfile', () => {
    it('hace PUT (no POST) con el nombre y el rate-limit, y devuelve el perfil creado', async () => {
      // RouterOS 7.23.5 responde "no such command" (400) a un POST de creación
      // en /rest/ppp/profile — verificado contra hardware real. El verbo correcto es PUT.
      http.put.mockResolvedValue({ data: { '.id': '*7', name: 'Sumtech-50Mbps', 'rate-limit': '50M/50M' } });

      const profile = await client.createProfile('Sumtech-50Mbps', '50M/50M');

      expect(profile).toEqual({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile',
        { name: 'Sumtech-50Mbps', 'rate-limit': '50M/50M' },
        expect.anything(),
      );
    });

    it('lanza un error legible si el PUT falla', async () => {
      http.put.mockRejectedValue({ response: { status: 500, data: {} } });

      await expect(client.createProfile('Sumtech-50Mbps', '50M/50M')).rejects.toThrow(/500/);
    });
  });

  describe('updateProfile', () => {
    it('hace PATCH sobre el .id del perfil con el rate-limit nuevo', async () => {
      http.patch.mockResolvedValue({ data: {} });

      await client.updateProfile('*7', '100M/100M');

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile/*7',
        { 'rate-limit': '100M/100M' },
        expect.anything(),
      );
    });

    it('lanza un error legible si el PATCH falla', async () => {
      http.patch.mockRejectedValue({ response: { status: 403, data: {} } });

      await expect(client.updateProfile('*7', '100M/100M')).rejects.toThrow(/403/);
    });
  });

  describe('ensureProfile', () => {
    it('crea el perfil cuando no existe todavía', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*7', name: 'Sumtech-50Mbps', 'rate-limit': '50M/50M' } });

      const profile = await client.ensureProfile('Sumtech-50Mbps', '50M/50M');

      expect(profile).toEqual({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      expect(http.put).toHaveBeenCalledTimes(1);
      expect(http.patch).not.toHaveBeenCalled();
    });

    it('actualiza el rate-limit cuando el perfil existe pero con un valor distinto', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*7', name: 'Sumtech-50Mbps', 'rate-limit': '20M/20M' }] });
      http.patch.mockResolvedValue({ data: {} });

      const profile = await client.ensureProfile('Sumtech-50Mbps', '50M/50M');

      expect(profile).toEqual({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile/*7',
        { 'rate-limit': '50M/50M' },
        expect.anything(),
      );
      expect(http.put).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya existe con el mismo rate-limit, no hace ningún PATCH ni PUT', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*7', name: 'Sumtech-50Mbps', 'rate-limit': '50M/50M' }] });

      const profile = await client.ensureProfile('Sumtech-50Mbps', '50M/50M');

      expect(profile).toEqual({ id: '*7', name: 'Sumtech-50Mbps', rateLimit: '50M/50M' });
      expect(http.put).not.toHaveBeenCalled();
      expect(http.patch).not.toHaveBeenCalled();
    });
  });

  describe('getProfiles', () => {
    it('obtiene la lista completa de perfiles y mapea propiedades', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            '.id': '*1',
            name: 'default',
            'rate-limit': '10M/10M',
            'local-address': '100.64.0.1',
            'remote-address': 'pool-clientes',
            'parent-queue': 'total-bandwidth',
            'only-one': 'yes',
          },
        ],
      });

      const profiles = await client.getProfiles();
      expect(profiles).toEqual([
        {
          id: '*1',
          name: 'default',
          rateLimit: '10M/10M',
          localAddress: '100.64.0.1',
          remoteAddress: 'pool-clientes',
          parentQueue: 'total-bandwidth',
          onlyOne: true,
        },
      ]);
      expect(http.get).toHaveBeenCalledWith('https://10.10.0.1:8729/rest/ppp/profile', expect.anything());
    });
  });

  describe('deleteProfile', () => {
    it('elimina el perfil por id llamando a DELETE /rest/ppp/profile/{id}', async () => {
      http.delete.mockResolvedValue({ data: {} });

      await client.deleteProfile('*9');
      expect(http.delete).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile/*9',
        expect.anything(),
      );
    });
  });

  describe('getIpPools', () => {
    it('obtiene la lista de pools de IP de /rest/ip/pool', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*2', name: 'pool-residencial', ranges: '100.64.0.2-100.64.0.254' }],
      });

      const pools = await client.getIpPools();
      expect(pools).toEqual([
        { id: '*2', name: 'pool-residencial', ranges: '100.64.0.2-100.64.0.254', nextPool: undefined },
      ]);
      expect(http.get).toHaveBeenCalledWith('https://10.10.0.1:8729/rest/ip/pool', expect.anything());
    });
  });

  describe('getPppSecrets', () => {
    it('obtiene todos los secretos de /rest/ppp/secret', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*3', name: 'user1', profile: 'PLAN-20M', disabled: 'false', 'remote-address': '100.64.0.25' }],
      });

      const secrets = await client.getPppSecrets();
      expect(secrets).toEqual([
        { id: '*3', name: 'user1', profile: 'PLAN-20M', disabled: false, service: undefined, remoteAddress: '100.64.0.25', comment: undefined },
      ]);
      expect(http.get).toHaveBeenCalledWith('https://10.10.0.1:8729/rest/ppp/secret', expect.anything());
    });
  });

  describe('findVlanInterfaceByVlanId / ensureVlanInterface', () => {
    it('findVlanInterfaceByVlanId devuelve null si ninguna VLAN coincide', async () => {
      http.get.mockResolvedValue({ data: [] });

      const result = await client.findVlanInterfaceByVlanId(400);

      expect(result).toBeNull();
      expect(http.get).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/interface/vlan',
        expect.objectContaining({ params: { 'vlan-id': '400' } }),
      );
    });

    it('ensureVlanInterface no crea nada si la VLAN ya existe (idempotente)', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*5', name: 'vlan400-clientes', 'vlan-id': '400', interface: 'ether5' }],
      });

      const result = await client.ensureVlanInterface({ name: 'vlan400-clientes', vlanId: 400, parentInterface: 'ether5' });

      expect(result).toEqual({ id: '*5', name: 'vlan400-clientes', vlanId: 400, interface: 'ether5' });
      expect(http.put).not.toHaveBeenCalled();
    });

    it('ensureVlanInterface crea la sub-interfaz vía PUT si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*6', name: 'vlan400-clientes', interface: 'ether5' } });

      const result = await client.ensureVlanInterface({
        name: 'vlan400-clientes',
        vlanId: 400,
        parentInterface: 'ether5',
        comment: 'Sumtech - VLAN clientes',
      });

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/interface/vlan',
        { name: 'vlan400-clientes', 'vlan-id': '400', interface: 'ether5', comment: 'Sumtech - VLAN clientes' },
        expect.anything(),
      );
      expect(result).toEqual({ id: '*6', name: 'vlan400-clientes', vlanId: 400, interface: 'ether5' });
    });
  });

  describe('findIpAddressByInterface / ensureIpAddress', () => {
    it('ensureIpAddress crea la IP vía PUT si la interfaz no tiene ninguna asignada', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*7', address: '10.20.0.1/24', interface: 'vlan400-clientes' } });

      const result = await client.ensureIpAddress('vlan400-clientes', '10.20.0.1/24', 'Gateway VLAN 400');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/address',
        { address: '10.20.0.1/24', interface: 'vlan400-clientes', comment: 'Gateway VLAN 400' },
        expect.anything(),
      );
      expect(result.address).toBe('10.20.0.1/24');
    });

    it('ensureIpAddress no duplica si la interfaz ya tiene exactamente esa IP', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*7', address: '10.20.0.1/24', interface: 'vlan400-clientes' }],
      });

      const result = await client.ensureIpAddress('vlan400-clientes', '10.20.0.1/24');

      expect(http.put).not.toHaveBeenCalled();
      expect(result.id).toBe('*7');
    });

    it('ensureIpAddress lanza si la interfaz ya tiene una IP distinta (no sobreescribe a ciegas)', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*7', address: '10.20.0.5/24', interface: 'vlan400-clientes' }],
      });

      await expect(client.ensureIpAddress('vlan400-clientes', '10.20.0.1/24')).rejects.toThrow(
        /ya tiene la IP/,
      );
    });
  });

  describe('ensureDhcpClient', () => {
    it('crea el cliente DHCP vía PUT con add-default-route=yes si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*8', interface: 'ether1' } });

      const result = await client.ensureDhcpClient('ether1');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-client',
        { interface: 'ether1', 'add-default-route': 'yes', 'use-peer-dns': 'yes' },
        expect.anything(),
      );
      expect(result).toEqual({ id: '*8', interface: 'ether1', disabled: false });
    });

    it('es idempotente: no crea nada si la interfaz ya tiene cliente DHCP', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*8', interface: 'ether1', disabled: 'false' }] });

      await client.ensureDhcpClient('ether1');

      expect(http.put).not.toHaveBeenCalled();
    });
  });

  describe('ensurePppoeClient', () => {
    it('crea la interfaz pppoe-client vía PUT si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*9', name: 'pppoe-wan', interface: 'ether1', user: 'isp-user' } });

      const result = await client.ensurePppoeClient({
        name: 'pppoe-wan',
        parentInterface: 'ether1',
        user: 'isp-user',
        password: 'isp-pass',
      });

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/interface/pppoe-client',
        { name: 'pppoe-wan', interface: 'ether1', user: 'isp-user', password: 'isp-pass', 'add-default-route': 'yes', disabled: 'no' },
        expect.anything(),
      );
      expect(result.name).toBe('pppoe-wan');
    });

    it('actualiza usuario/contraseña vía PATCH si la interfaz ya existe', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*9', name: 'pppoe-wan', interface: 'ether1', user: 'old-user', disabled: 'false' }],
      });

      await client.ensurePppoeClient({ name: 'pppoe-wan', parentInterface: 'ether1', user: 'new-user', password: 'new-pass' });

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/interface/pppoe-client/*9',
        { user: 'new-user', password: 'new-pass' },
        expect.anything(),
      );
    });
  });

  describe('ensureDefaultRoute', () => {
    it('crea la ruta 0.0.0.0/0 vía PUT si no existe ninguna', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*10', gateway: '200.1.1.1' } });

      const result = await client.ensureDefaultRoute('200.1.1.1', 'Sumtech - WAN');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/route',
        { 'dst-address': '0.0.0.0/0', gateway: '200.1.1.1', comment: 'Sumtech - WAN' },
        expect.anything(),
      );
      expect(result.gateway).toBe('200.1.1.1');
    });

    it('lanza si ya existe una ruta por defecto hacia un gateway distinto (no sobreescribe)', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*10', 'dst-address': '0.0.0.0/0', gateway: '200.1.1.9' }] });

      await expect(client.ensureDefaultRoute('200.1.1.1')).rejects.toThrow(/Ya existe una ruta por defecto/);
    });
  });

  describe('ensureNatMasquerade', () => {
    it('crea la regla de masquerade vía PUT si no existe ninguna con ese comentario', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: {} });

      await client.ensureNatMasquerade('ether1');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/firewall/nat',
        { chain: 'srcnat', action: 'masquerade', 'out-interface': 'ether1', comment: 'sumtech-nat-masquerade' },
        expect.anything(),
      );
    });

    it('es idempotente: no duplica si ya existe una regla con el mismo comentario', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*11', comment: 'sumtech-nat-masquerade' }] });

      await client.ensureNatMasquerade('ether1');

      expect(http.put).not.toHaveBeenCalled();
    });
  });

  describe('ensureFirewallBaseline', () => {
    it('crea las 2 reglas base (established/related + drop invalid) si no existen', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: {} });

      await client.ensureFirewallBaseline();

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/firewall/filter',
        expect.objectContaining({ comment: 'sumtech-baseline-established', action: 'accept' }),
        expect.anything(),
      );
      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/firewall/filter',
        expect.objectContaining({ comment: 'sumtech-baseline-drop-invalid', action: 'drop' }),
        expect.anything(),
      );
      expect(http.put).toHaveBeenCalledTimes(2);
    });

    it('es idempotente: no duplica reglas que ya existen por comentario', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*1', comment: 'sumtech-baseline-established' }, { '.id': '*2', comment: 'sumtech-baseline-drop-invalid' }],
      });

      await client.ensureFirewallBaseline();

      expect(http.put).not.toHaveBeenCalled();
    });
  });

  describe('ensureIpPool', () => {
    it('crea el pool vía PUT si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*20', name: 'pool-vlan400', ranges: '10.20.0.10-10.20.0.250' } });

      const result = await client.ensureIpPool('pool-vlan400', '10.20.0.10-10.20.0.250');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/pool',
        { name: 'pool-vlan400', ranges: '10.20.0.10-10.20.0.250' },
        expect.anything(),
      );
      expect(result.name).toBe('pool-vlan400');
    });

    it('es idempotente: no duplica si el pool ya existe por nombre', async () => {
      http.get.mockResolvedValue({ data: [{ '.id': '*20', name: 'pool-vlan400', ranges: '10.20.0.10-10.20.0.250' }] });
      await client.ensureIpPool('pool-vlan400', '10.20.0.10-10.20.0.250');
      expect(http.put).not.toHaveBeenCalled();
    });
  });

  describe('ensureDhcpServerNetwork / ensureDhcpServer', () => {
    it('crea la red DHCP vía PUT si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: {} });

      await client.ensureDhcpServerNetwork('10.20.0.0/24', '10.20.0.1', '8.8.8.8');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-server/network',
        { address: '10.20.0.0/24', gateway: '10.20.0.1', 'dns-server': '8.8.8.8' },
        expect.anything(),
      );
    });

    it('ensureDhcpServer crea el servidor vía PUT si la interfaz no tiene uno', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*21', name: 'dhcp-vlan400' } });

      const result = await client.ensureDhcpServer('dhcp-vlan400', 'vlan400', 'pool-vlan400', 86400);

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-server',
        { name: 'dhcp-vlan400', interface: 'vlan400', 'address-pool': 'pool-vlan400', 'lease-time': '86400s', disabled: 'no' },
        expect.anything(),
      );
      expect(result.name).toBe('dhcp-vlan400');
    });
  });

  describe('ensureStaticLease / setLeaseDisabled', () => {
    it('crea la lease vía PUT si no existe ninguna con esa MAC', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*22', address: '10.20.0.50', 'mac-address': 'AA:BB:CC:DD:EE:FF', server: 'dhcp-vlan400' } });

      const result = await client.ensureStaticLease('AA:BB:CC:DD:EE:FF', '10.20.0.50', 'dhcp-vlan400', 'Contrato:c-1');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-server/lease',
        { 'mac-address': 'AA:BB:CC:DD:EE:FF', address: '10.20.0.50', server: 'dhcp-vlan400', disabled: 'no', comment: 'Contrato:c-1' },
        expect.anything(),
      );
      expect(result.address).toBe('10.20.0.50');
    });

    it('actualiza la IP vía PATCH si la lease ya existe con otra dirección', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*22', address: '10.20.0.40', 'mac-address': 'AA:BB:CC:DD:EE:FF', server: 'dhcp-vlan400', disabled: 'false' }],
      });

      await client.ensureStaticLease('AA:BB:CC:DD:EE:FF', '10.20.0.50', 'dhcp-vlan400');

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-server/lease/*22',
        { address: '10.20.0.50' },
        expect.anything(),
      );
    });

    it('setLeaseDisabled hace PATCH disabled=true', async () => {
      await client.setLeaseDisabled('*22', true);
      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ip/dhcp-server/lease/*22',
        { disabled: 'true' },
        expect.anything(),
      );
    });
  });

  describe('ensureSimpleQueue / setSimpleQueueDisabled', () => {
    it('crea la simple-queue vía PUT si no existe', async () => {
      http.get.mockResolvedValue({ data: [] });
      http.put.mockResolvedValue({ data: { '.id': '*23', name: 'q-contrato-1', target: '10.20.0.50/32', 'max-limit': '10M/10M' } });

      const result = await client.ensureSimpleQueue('q-contrato-1', '10.20.0.50/32', '10M/10M');

      expect(http.put).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/queue/simple',
        { name: 'q-contrato-1', target: '10.20.0.50/32', 'max-limit': '10M/10M', disabled: 'no' },
        expect.anything(),
      );
      expect(result.maxLimit).toBe('10M/10M');
    });

    it('actualiza max-limit vía PATCH si la queue ya existe con otro límite', async () => {
      http.get.mockResolvedValue({
        data: [{ '.id': '*23', name: 'q-contrato-1', target: '10.20.0.50/32', 'max-limit': '5M/5M', disabled: 'false' }],
      });

      await client.ensureSimpleQueue('q-contrato-1', '10.20.0.50/32', '20M/20M');

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/queue/simple/*23',
        { 'max-limit': '20M/20M' },
        expect.anything(),
      );
    });

    it('setSimpleQueueDisabled hace PATCH disabled=true', async () => {
      await client.setSimpleQueueDisabled('*23', true);
      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/queue/simple/*23',
        { disabled: 'true' },
        expect.anything(),
      );
    });
  });
});
