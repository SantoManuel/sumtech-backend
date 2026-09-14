import { GenieAcsClient } from './genieacs-client';

describe('GenieAcsClient', () => {
  let http: { get: jest.Mock; post: jest.Mock; delete: jest.Mock };
  let client: GenieAcsClient;

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn(), delete: jest.fn() };
    client = new GenieAcsClient({ baseUrl: 'https://acs.sumtech.local', apiKey: 'test-key' }, http);
  });

  describe('findDeviceBySerial', () => {
    it('busca por _deviceId._SerialNumber y devuelve el primer _id encontrado', async () => {
      http.get.mockResolvedValue({ data: [{ _id: '00259E-ONT-16' }] });

      const deviceId = await client.findDeviceBySerial('16');

      expect(deviceId).toBe('00259E-ONT-16');
      expect(http.get).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/',
        expect.objectContaining({
          headers: { 'X-API-Key': 'test-key' },
          params: { query: JSON.stringify({ '_deviceId._SerialNumber': '16' }) },
        }),
      );
    });

    it('devuelve null (no es un error) si el CPE nunca hizo bootstrap todavía', async () => {
      http.get.mockResolvedValue({ data: [] });

      const deviceId = await client.findDeviceBySerial('serial-inexistente');

      expect(deviceId).toBeNull();
    });

    it('lanza un error legible si la NBI responde con error', async () => {
      http.get.mockRejectedValue({ response: { status: 401, data: { message: 'invalid key' } } });

      await expect(client.findDeviceBySerial('16')).rejects.toThrow(/401/);
    });
  });

  describe('getDeviceStatus', () => {
    it('parsea un documento TR-098 (InternetGatewayDevice)', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            _id: '00259E-ONT-16',
            _lastInform: '2026-09-14T23:18:42.971Z',
            _registered: '2026-09-14T20:00:00.000Z',
            _deviceId: { _Manufacturer: 'Huawei', _SerialNumber: '16' },
            InternetGatewayDevice: {
              LANDevice: {
                '1': {
                  WLANConfiguration: {
                    '1': { SSID: { _value: 'Sumtech_100M_ABC123' } },
                    '2': { SSID: { _value: 'Sumtech_100M_ABC123_5G' } },
                  },
                },
              },
              WANDevice: {
                '1': { WANDSLInterfaceConfig: { X_Sumtech_OpticalRxPower: { _value: '-18.5' } } },
              },
            },
          },
        ],
      });

      const status = await client.getDeviceStatus('00259E-ONT-16');

      expect(status.isTR181).toBe(false);
      expect(status.ssid).toBe('Sumtech_100M_ABC123');
      expect(status.ssid5g).toBe('Sumtech_100M_ABC123_5G');
      expect(status.opticalRxPowerDbm).toBe(-18.5);
      expect(status.manufacturer).toBe('Huawei');
      expect(status.lastInformAt).toEqual(new Date('2026-09-14T23:18:42.971Z'));
    });

    it('parsea un documento TR-181 (Device.*)', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            _id: 'ZTE-ONT-20',
            _deviceId: {},
            Device: {
              WiFi: {
                SSID: { '1': { SSID: { _value: 'Sumtech_200M_XYZ' } } },
              },
              Optical: { Interface: { '1': { OpticalSignalLevel: { _value: '-20.1' } } } },
            },
          },
        ],
      });

      const status = await client.getDeviceStatus('ZTE-ONT-20');

      expect(status.isTR181).toBe(true);
      expect(status.ssid).toBe('Sumtech_200M_XYZ');
      expect(status.opticalRxPowerDbm).toBe(-20.1);
    });

    it('no revienta si faltan parámetros ópticos o de segunda radio (CPE de una sola banda)', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            _id: '00259E-ONT-16',
            _deviceId: {},
            InternetGatewayDevice: { LANDevice: { '1': { WLANConfiguration: { '1': { SSID: { _value: 'X' } } } } } },
          },
        ],
      });

      const status = await client.getDeviceStatus('00259E-ONT-16');

      expect(status.ssid).toBe('X');
      expect(status.ssid5g).toBeUndefined();
      expect(status.opticalRxPowerDbm).toBeUndefined();
    });

    it('lanza un error legible si el dispositivo no existe', async () => {
      http.get.mockResolvedValue({ data: [] });

      await expect(client.getDeviceStatus('id-inexistente')).rejects.toThrow(/no tiene ningún dispositivo/);
    });
  });

  describe('setWifiCredentials', () => {
    it('en TR-098, hace PATCH-equivalente (setParameterValues) sobre WLANConfiguration.1 y marca WIFI_CUSTOMIZED', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'MiCasa', password: 'ClaveSegura123' });

      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        {
          name: 'setParameterValues',
          parameterValues: [
            ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', 'MiCasa', 'xsd:string'],
            ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase', 'ClaveSegura123', 'xsd:string'],
          ],
        },
        expect.anything(),
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tags/WIFI_CUSTOMIZED/',
        {},
        expect.anything(),
      );
    });

    it('en TR-181, usa el árbol Device.WiFi.*', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('ZTE-ONT-20', true, { ssid: 'MiCasa', password: 'ClaveSegura123' });

      expect(http.post).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/?connection_request=true'),
        {
          name: 'setParameterValues',
          parameterValues: [
            ['Device.WiFi.SSID.1.SSID', 'MiCasa', 'xsd:string'],
            ['Device.WiFi.AccessPoint.1.Security.KeyPassphrase', 'ClaveSegura123', 'xsd:string'],
          ],
        },
        expect.anything(),
      );
    });

    it('incluye la segunda radio (5GHz) solo si se provee ssid5g', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('00259E-ONT-16', false, {
        ssid: 'MiCasa',
        ssid5g: 'MiCasa_5G',
        password: 'ClaveSegura123',
      });

      const [, body] = http.post.mock.calls[0];
      expect(body.parameterValues).toEqual(
        expect.arrayContaining([
          ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID', 'MiCasa_5G', 'xsd:string'],
          ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.KeyPassphrase', 'ClaveSegura123', 'xsd:string'],
        ]),
      );
    });

    it('codifica el deviceId aunque contenga caracteres especiales (%)', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('00259E-EchoLife%20HG8245H5-16', false, {
        ssid: 'X',
        password: 'ClaveSegura123',
      });

      expect(http.post.mock.calls[0][0]).toContain(encodeURIComponent('00259E-EchoLife%20HG8245H5-16'));
    });

    it('lanza un error legible si la tarea falla', async () => {
      http.post.mockRejectedValue({ response: { status: 500, data: {} } });

      await expect(
        client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'X', password: 'ClaveSegura123' }),
      ).rejects.toThrow(/500/);
    });
  });

  describe('clearWifiCustomization', () => {
    it('borra el tag WIFI_CUSTOMIZED', async () => {
      http.delete.mockResolvedValue({ data: {} });

      await client.clearWifiCustomization('00259E-ONT-16');

      expect(http.delete).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tags/WIFI_CUSTOMIZED/',
        expect.anything(),
      );
    });
  });

  describe('rebootDevice', () => {
    it('encola una tarea reboot con connection_request', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.rebootDevice('00259E-ONT-16');

      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        { name: 'reboot' },
        expect.anything(),
      );
    });

    it('lanza un error legible si falla', async () => {
      http.post.mockRejectedValue({ code: 'ECONNABORTED' });

      await expect(client.rebootDevice('00259E-ONT-16')).rejects.toThrow(/tiempo de espera/i);
    });
  });
});
