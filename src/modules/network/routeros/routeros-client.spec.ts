import { RouterOsClient } from './routeros-client';

describe('RouterOsClient', () => {
  let http: { get: jest.Mock; put: jest.Mock; patch: jest.Mock };
  let client: RouterOsClient;

  beforeEach(() => {
    http = { get: jest.fn(), put: jest.fn(), patch: jest.fn() };
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

  describe('updateProfileRateLimit', () => {
    it('hace PATCH sobre el .id del perfil con el rate-limit nuevo', async () => {
      http.patch.mockResolvedValue({ data: {} });

      await client.updateProfileRateLimit('*7', '100M/100M');

      expect(http.patch).toHaveBeenCalledWith(
        'https://10.10.0.1:8729/rest/ppp/profile/*7',
        { 'rate-limit': '100M/100M' },
        expect.anything(),
      );
    });

    it('lanza un error legible si el PATCH falla', async () => {
      http.patch.mockRejectedValue({ response: { status: 403, data: {} } });

      await expect(client.updateProfileRateLimit('*7', '100M/100M')).rejects.toThrow(/403/);
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
});
