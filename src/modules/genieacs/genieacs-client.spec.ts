import * as crypto from 'crypto';
import { GenieAcsClient } from './genieacs-client';

function wpaPsk(ssid: string, password: string): string {
  return crypto.pbkdf2Sync(password, ssid, 4096, 32, 'sha1').toString('hex');
}

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

    it('un valor que no tiene forma de MAC y no matchea por serial devuelve null SIN intentar fallback por MAC', async () => {
      http.get.mockResolvedValue({ data: [] });

      const deviceId = await client.findDeviceBySerial('485754435D448091');

      expect(deviceId).toBeNull();
      // Solo el intento por _deviceId._SerialNumber — "485754435D448091" no
      // tiene 12 dígitos hex exactos tras limpiar separadores, así que no
      // vale la pena tantear MACAddress/BSSID.
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    describe('fallback por MAC (ONUs EPON/HiOSO cuyo "serial" en Sumtech es en realidad una MAC)', () => {
      it('si no hay match por serial pero el valor tiene forma de MAC, busca en los parámetros MACAddress/BSSID del árbol TR-069', async () => {
        http.get
          .mockResolvedValueOnce({ data: [] }) // 1) _deviceId._SerialNumber exacto -> nada
          .mockResolvedValueOnce({ data: [{ _id: '00259E-HG8546M-48575443D309A69C' }] }); // 2) match exacto de MAC

        const deviceId = await client.findDeviceBySerial('04:b0:e7:d3:09:a6');

        expect(deviceId).toBe('00259E-HG8546M-48575443D309A69C');
        expect(http.get).toHaveBeenCalledTimes(2);

        const secondCallQuery = JSON.parse(http.get.mock.calls[1][1].params.query);
        expect(secondCallQuery.$or).toEqual(
          expect.arrayContaining([
            { 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress._value': { $regex: '^04[:-]?b0[:-]?e7[:-]?d3[:-]?09[:-]?a6$', $options: 'i' } },
          ]),
        );
      });

      it('el match por MAC es insensible a mayúsculas/minúsculas y a cómo el CPE separó los octetos (verificado contra GenieACS real)', async () => {
        http.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ _id: 'dev-x' }] });

        const deviceId = await client.findDeviceBySerial('B4-54-59-6F-12-04');

        expect(deviceId).toBe('dev-x');
        const secondCallQuery = JSON.parse(http.get.mock.calls[1][1].params.query);
        expect(secondCallQuery.$or[0]).toEqual({
          'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress._value': {
            $regex: '^b4[:-]?54[:-]?59[:-]?6f[:-]?12[:-]?04$',
            $options: 'i',
          },
        });
      });

      it('sin match exacto de serial ni de MAC, tantea un corrimiento de ±4 en el último octeto como último recurso', async () => {
        http.get
          .mockResolvedValueOnce({ data: [] }) // serial exacto
          .mockResolvedValueOnce({ data: [] }) // MAC exacta
          .mockResolvedValueOnce({ data: [{ _id: '00259E-EG8141A5-485754435D448091' }] }); // MAC cercana (último octeto distinto)

        const deviceId = await client.findDeviceBySerial('b4:54:59:6f:12:04');

        expect(deviceId).toBe('00259E-EG8141A5-485754435D448091');
        expect(http.get).toHaveBeenCalledTimes(3);

        const thirdCallQuery = JSON.parse(http.get.mock.calls[2][1].params.query);
        // UNA sola cláusula por path (no una por combinación path×candidato): el
        // prefijo de los primeros 5 octetos queda fijo y solo el último octeto
        // se alterna dentro de un único regex -- así la query no vuelve a crecer
        // en tamaño sin importar cuántos candidatos de tolerancia se tanteen
        // (ver el 431 "Request Header Fields Too Large" real que motivó esto).
        expect(thirdCallQuery.$or).toHaveLength(15);
        const clause = thirdCallQuery.$or.find(
          (c: any) => 'InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress._value' in c,
        );
        expect(clause['InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress._value']).toEqual({
          $regex: '^b4[:-]?54[:-]?59[:-]?6f[:-]?12[:-]?(?:00|01|02|03|05|06|07|08)$',
          $options: 'i',
        });
        // El valor exacto (delta 0, "04") no debe aparecer en la alternación del tercer intento -- ya se descartó en el segundo.
        expect(clause['InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1.MACAddress._value'].$regex).not.toMatch(/\b04\b/);
      });

      it('la query del nivel de tolerancia se mantiene acotada en tamaño sin importar cuántos candidatos se tanteen (evita el 431 real de producción)', async () => {
        http.get.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [] });

        await client.findDeviceBySerial('b4:54:59:6f:12:04');

        const thirdCallQueryString = http.get.mock.calls[2][1].params.query as string;
        // Antes del fix, 15 paths × 8 candidatos completos de 12-hex-digitos
        // generaba una query de ~17 000 caracteres sin codificar -- muy por
        // encima de cualquier límite razonable de cabecera HTTP. La versión
        // compacta (prefijo fijo + alternación de solo el último octeto) debe
        // quedar muy por debajo de eso.
        expect(thirdCallQueryString.length).toBeLessThan(4000);
      });

      it('loguea una advertencia cuando el match fue por aproximación de MAC (no exacto)', async () => {
        const warnSpy = jest.spyOn((client as any).logger, 'warn').mockImplementation(() => undefined);
        http.get
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [] })
          .mockResolvedValueOnce({ data: [{ _id: 'dev-aproximado' }] });

        await client.findDeviceBySerial('b4:54:59:6f:12:04');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dev-aproximado'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('aproximación'));
      });

      it('agota los 3 niveles (serial, MAC exacta, MAC cercana) y devuelve null si ninguno matchea', async () => {
        http.get.mockResolvedValue({ data: [] });

        const deviceId = await client.findDeviceBySerial('b4:54:59:6f:12:04');

        expect(deviceId).toBeNull();
        expect(http.get).toHaveBeenCalledTimes(3);
      });

      it('no intenta ningún fallback de MAC si el match por serial ya tuvo éxito', async () => {
        http.get.mockResolvedValueOnce({ data: [{ _id: 'ya-encontrado' }] });

        const deviceId = await client.findDeviceBySerial('b4:54:59:6f:12:04');

        expect(deviceId).toBe('ya-encontrado');
        expect(http.get).toHaveBeenCalledTimes(1);
      });

      it('propaga el error de la NBI si falla durante el intento de fallback por MAC', async () => {
        http.get
          .mockResolvedValueOnce({ data: [] })
          .mockRejectedValueOnce({ response: { status: 500, data: { message: 'mongo down' } } });

        await expect(client.findDeviceBySerial('b4:54:59:6f:12:04')).rejects.toThrow(/500/);
      });
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
      expect(status.tags).toEqual([]);
    });

    it('expone los tags reales del documento ("_tags") -- usados para identificar tenant/OLT en una NBI compartida entre tenants', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            _id: '00259E-ONT-16',
            _deviceId: {},
            _tags: ['tenant:sumtech', 'olt:OLT_Tabara_Abajo'],
            InternetGatewayDevice: {},
          },
        ],
      });

      const status = await client.getDeviceStatus('00259E-ONT-16');

      expect(status.tags).toEqual(['tenant:sumtech', 'olt:OLT_Tabara_Abajo']);
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
    it('en TR-098, hace PATCH-equivalente (setParameterValues) sobre WLANConfiguration.1, incluye el PSK hex derivado, marca WIFI_CUSTOMIZED y reinicia el equipo', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'MiCasa', password: 'ClaveSegura123' });

      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        {
          name: 'setParameterValues',
          parameterValues: [
            ['InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID', 'MiCasa', 'xsd:string'],
            [
              'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase',
              'ClaveSegura123',
              'xsd:string',
            ],
            [
              'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey',
              wpaPsk('MiCasa', 'ClaveSegura123'),
              'xsd:string',
            ],
          ],
        },
        expect.anything(),
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tags/WIFI_CUSTOMIZED/',
        {},
        expect.anything(),
      );
      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        { name: 'reboot' },
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
          [
            'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.KeyPassphrase',
            'ClaveSegura123',
            'xsd:string',
          ],
          [
            'InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.PreSharedKey',
            wpaPsk('MiCasa_5G', 'ClaveSegura123'),
            'xsd:string',
          ],
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

    it('lanza error si GenieACS respondió 2xx pero el CPE rechazó la clave (fault real de setParameterValues)', async () => {
      http.post.mockResolvedValueOnce({ data: { _id: 'task-123' } });
      http.get.mockResolvedValue({
        data: [
          {
            _id: '00259E-ONT-16:task_task-123',
            message: 'Invalid arguments',
            detail: {
              faultCode: '9003',
              faultString: 'Invalid arguments',
              setParameterValuesFault: [
                {
                  parameterName: 'InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase',
                  faultCode: '9007',
                  faultString: 'Invalid parameter value',
                },
              ],
            },
          },
        ],
      });

      await expect(
        client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'X', password: '12345678' }),
      ).rejects.toThrow(/Invalid parameter value/);

      // No debe marcar WIFI_CUSTOMIZED si el CPE rechazó el cambio real.
      expect(http.post).toHaveBeenCalledTimes(1);
    });

    it('no revienta si GenieACS no devolvió el _id de la tarea (no se puede verificar, no se asume fallo)', async () => {
      http.post.mockResolvedValue({ data: {} });

      await client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'X', password: 'ClaveSegura123' });

      expect(http.get).not.toHaveBeenCalled();
      // setParameterValues + tag WIFI_CUSTOMIZED + reboot (reinicio obligatorio para que el radio tome el PSK nuevo).
      expect(http.post).toHaveBeenCalledTimes(3);
    });

    it('confirma éxito (sin fault registrado), marca WIFI_CUSTOMIZED y reinicia el equipo', async () => {
      http.post.mockResolvedValue({ data: { _id: 'task-456' } });
      http.get.mockResolvedValue({ data: [] });

      await client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'X', password: 'ClaveSegura123' });

      expect(http.get).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/faults/',
        expect.objectContaining({
          params: { query: JSON.stringify({ _id: '00259E-ONT-16:task_task-456' }) },
        }),
      );
      expect(http.post).toHaveBeenCalledTimes(3);
      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        { name: 'reboot' },
        expect.anything(),
      );
    });

    it('no revienta si el reinicio automático falla -- la clave ya quedó guardada, solo se registra el warning', async () => {
      http.post.mockImplementation((url: string, body: any) => {
        if (body?.name === 'reboot') {
          return Promise.reject({ response: { status: 500, data: {} } });
        }
        return Promise.resolve({ data: {} });
      });

      await expect(
        client.setWifiCredentials('00259E-ONT-16', false, { ssid: 'X', password: 'ClaveSegura123' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('setParameterValues', () => {
    it('lanza error si GenieACS respondió 2xx pero el CPE rechazó el cambio (fault real)', async () => {
      http.post.mockResolvedValueOnce({ data: { _id: 'task-789' } });
      http.get.mockResolvedValue({
        data: [
          {
            _id: '00259E-ONT-16:task_task-789',
            message: 'Invalid parameter name',
            detail: { setParameterValuesFault: [{ faultString: 'Invalid parameter name' }] },
          },
        ],
      });

      await expect(
        client.setParameterValues('00259E-ONT-16', [['InternetGatewayDevice.X', 'y', 'xsd:string']]),
      ).rejects.toThrow(/Invalid parameter name/);
    });

    it('resuelve sin error si no hay fault registrado', async () => {
      http.post.mockResolvedValue({ data: { _id: 'task-789' } });
      http.get.mockResolvedValue({ data: [] });

      await expect(
        client.setParameterValues('00259E-ONT-16', [['InternetGatewayDevice.X', 'y', 'xsd:string']]),
      ).resolves.toBeUndefined();
    });
  });

  describe('objectInstanceExists', () => {
    const instancePath = 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1';

    it('usa "...NumberOfEntries" si existe como parámetro hermano, en vez del nodo del objeto', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            InternetGatewayDevice: {
              WANDevice: {
                '1': {
                  WANConnectionDevice: {
                    '1': {
                      // Nodo "fantasma" declarado por un SetParameterValues previo fallido --
                      // NO debe hacer que esto reporte "existe".
                      WANPPPConnection: { '1': { Enable: { _value: 'true' } } },
                      WANPPPConnectionNumberOfEntries: { _value: '0' },
                    },
                  },
                },
              },
            },
          },
        ],
      });

      await expect(client.objectInstanceExists('00259E-ONT-16', instancePath)).resolves.toBe(false);
    });

    it('reporta true si "...NumberOfEntries" confirma la instancia', async () => {
      http.get.mockResolvedValue({
        data: [
          {
            InternetGatewayDevice: {
              WANDevice: {
                '1': {
                  WANConnectionDevice: {
                    '1': {
                      WANPPPConnection: { '1': { Enable: { _value: 'true' } } },
                      WANPPPConnectionNumberOfEntries: { _value: '1' },
                    },
                  },
                },
              },
            },
          },
        ],
      });

      await expect(client.objectInstanceExists('00259E-ONT-16', instancePath)).resolves.toBe(true);
    });

    it('sin "NumberOfEntries" hermano (ej. TR-181), cae al chequeo directo del nodo', async () => {
      http.get.mockResolvedValue({
        data: [{ Device: { PPP: { Interface: { '1': { Enable: { _value: 'true' } } } } } }],
      });

      await expect(client.objectInstanceExists('ZTE-ONT-20', 'Device.PPP.Interface.1')).resolves.toBe(true);
      await expect(client.objectInstanceExists('ZTE-ONT-20', 'Device.PPP.Interface.2')).resolves.toBe(false);
    });
  });

  describe('addObject', () => {
    it('manda la tarea "addObject" con el objectName dado y verifica el resultado real', async () => {
      http.post.mockResolvedValueOnce({ data: { _id: 'task-999' } });
      http.get.mockResolvedValue({ data: [] });

      await client.addObject(
        '00259E-ONT-16',
        'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.',
      );

      expect(http.post).toHaveBeenCalledWith(
        'https://acs.sumtech.local/api/v1/devices/00259E-ONT-16/tasks/?connection_request=true',
        {
          name: 'addObject',
          objectName: 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.',
        },
        expect.anything(),
      );
    });

    it('lanza error si el CPE rechaza el AddObject (fault real)', async () => {
      http.post.mockResolvedValueOnce({ data: { _id: 'task-999' } });
      http.get.mockResolvedValue({
        data: [{ _id: '00259E-ONT-16:task_task-999', message: 'No se pudo crear el objeto' }],
      });

      await expect(
        client.addObject('00259E-ONT-16', 'InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.'),
      ).rejects.toThrow(/No se pudo crear el objeto/);
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
