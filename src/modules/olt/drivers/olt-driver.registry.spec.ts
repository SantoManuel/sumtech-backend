import { OltDriverRegistry } from './olt-driver.registry';
import { ZteC320Driver } from './zte-c320.driver';
import { HuaweiMa5800Driver } from './huawei-ma5800.driver';
import { HiosoDriver } from './hioso.driver';
import { HsgqDriver } from './hsgq.driver';
import { UnknownOltVendorError } from '../ports/olt-driver.port';

describe('OltDriverRegistry', () => {
  let zteDriver: ZteC320Driver;
  let huaweiDriver: HuaweiMa5800Driver;
  let hiosoDriver: HiosoDriver;
  let hsgqDriver: HsgqDriver;
  let registry: OltDriverRegistry;

  beforeEach(() => {
    zteDriver = new ZteC320Driver();
    huaweiDriver = new HuaweiMa5800Driver();
    hiosoDriver = new HiosoDriver();
    hsgqDriver = new HsgqDriver();
    registry = new OltDriverRegistry(zteDriver, huaweiDriver, hiosoDriver, hsgqDriver);
  });

  describe('listAll() — capacidades por fabricante para el frontend', () => {
    it('lista los 4 fabricantes registrados con sus capacidades reales', () => {
      const list = registry.listAll();

      expect(list).toHaveLength(4);
      expect(list.map((v) => v.vendor)).toEqual(['ZTE', 'HUAWEI', 'HIOSO', 'HSGQ']);

      const zte = list.find((v) => v.vendor === 'ZTE')!;
      expect(zte.capabilities).toEqual(zteDriver.getCapabilities());
      expect(zte.capabilities.onuAuthorize).toBe(true);

      const hioso = list.find((v) => v.vendor === 'HIOSO')!;
      expect(hioso.capabilities.systemHealth).toBe(true);
      expect(hioso.capabilities.onuAuthorize).toBe(false);
    });
  });

  describe('resolve() — enrutamiento por fabricante', () => {
    it('resuelve ZTE al driver real', () => {
      expect(registry.resolve('ZTE')).toBe(zteDriver);
    });

    it('resuelve HUAWEI a su propio driver registrado', () => {
      expect(registry.resolve('HUAWEI')).toBe(huaweiDriver);
    });

    it('resuelve HIOSO a su propio driver registrado', () => {
      expect(registry.resolve('HIOSO')).toBe(hiosoDriver);
    });

    it('resuelve HSGQ a su propio driver registrado', () => {
      expect(registry.resolve('HSGQ')).toBe(hsgqDriver);
    });

    it('nunca resuelve un vendor desconocido a ZteC320Driver por defecto', () => {
      expect(() => registry.resolve('MARCA-DESCONOCIDA')).toThrow(UnknownOltVendorError);
    });

    it('lanza UnknownOltVendorError para vendor vacío', () => {
      expect(() => registry.resolve('')).toThrow(UnknownOltVendorError);
    });

    it('lanza UnknownOltVendorError para vendor indefinido', () => {
      expect(() => registry.resolve(undefined)).toThrow(UnknownOltVendorError);
    });
  });

  describe('integración — una OLT HiOSO jamás ejecuta código de ZteC320Driver', () => {
    it('resolve(HIOSO).testConnection() nunca invoca ZteC320Driver.prototype.testConnection', async () => {
      const zteSpy = jest.spyOn(ZteC320Driver.prototype, 'testConnection');

      const driver = registry.resolve('HiOSO');
      // HiosoDriver.testConnection() ya hace un intento de conexión Telnet real
      // (ver test/fixtures/hioso) — timeoutMs corto para que el test falle rápido
      // por host inalcanzable, sin depender de ZteC320Driver.
      const result = await driver.testConnection({ host: '10.0.0.50', port: 23, username: 'admin', password: 'x', timeoutMs: 300 });

      expect(zteSpy).not.toHaveBeenCalled();
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      zteSpy.mockRestore();
    });
  });

  describe('drivers no implementados — nunca retornan éxito simulado', () => {
    // HiosoDriver ya tiene evidencia real para testConnection/systemInfo/
    // discoverInterfaces (ver hioso.driver.spec.ts) — queda fuera de estas
    // pruebas genéricas de "stub puro" junto con Huawei/HSGQ.
    it.each([
      ['HuaweiMa5800Driver', () => new HuaweiMa5800Driver()],
      ['HsgqDriver', () => new HsgqDriver()],
    ])('%s: getCapabilities() retorna todo en false', (_name, factory) => {
      const driver = factory();
      const caps = driver.getCapabilities();
      expect(Object.values(caps).every((v) => v === false)).toBe(true);
    });

    it.each([
      ['HuaweiMa5800Driver', () => new HuaweiMa5800Driver()],
      ['HsgqDriver', () => new HsgqDriver()],
    ])('%s: testConnection() retorna ok:false en vez de simular conexión real', async (_name, factory) => {
      const driver = factory();
      const result = await driver.testConnection({ host: '10.0.0.1', port: 23, username: 'a', password: 'b' });
      expect(result.ok).toBe(false);
    });

    it.each([
      ['HuaweiMa5800Driver', () => new HuaweiMa5800Driver()],
      ['HsgqDriver', () => new HsgqDriver()],
    ])('%s: discoverInterfaces() lanza en vez de inventar puertos', async (_name, factory) => {
      const driver = factory();
      await expect(
        driver.discoverInterfaces({ host: '10.0.0.1', port: 23, username: 'a', password: 'b' }),
      ).rejects.toThrow('no está implementada');
    });

    it('HiosoDriver: getUnconfiguredOnus/authorizeOnu siguen sin implementar (no hay evidencia real todavía)', async () => {
      const driver = new HiosoDriver();
      const params = { host: '10.0.0.1', port: 23, username: 'a', password: 'b' };
      await expect(driver.getUnconfiguredOnus(params)).rejects.toThrow('no está implementada');
      const authResult = await driver.authorizeOnu(params, {
        ponInterface: 'epon 1/1',
        onuId: 1,
        modelTypeName: 'HIOSO-GENERIC',
        serialNumber: 'X',
        serviceVlan: 1,
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      });
      expect(authResult.ok).toBe(false);
    });
  });
});
