import {
  resolveCpeIpv6Capabilities,
  CPE_IPV6_CAPABILITY_PROFILES,
} from './cpe-capabilities';

describe('CpeCapabilities (Fase 2 / 3.0 -- Capacidades IPv6 de CPE)', () => {
  describe('resolveCpeIpv6Capabilities', () => {
    it('resuelve el perfil HUAWEI cuando el vendor es HUAWEI (case-insensitive)', () => {
      const res = resolveCpeIpv6Capabilities('Huawei');
      expect(res.capabilities.pppoeDualStack).toBe(true);
      expect(res.capabilities.pppoePrefixReadback).toBe(true);
      expect(res.capabilities.dhcpDualStack).toBe(false);
      expect(res.capabilities.staticIpv6).toBe(false);
      expect(res.notes.dhcpDualStack).toContain('firmware TR-098 de este fabricante');
    });

    it('resuelve el perfil HUAWEI cuando el vendor es CMDC (clon de Huawei en lab)', () => {
      const res = resolveCpeIpv6Capabilities('CMDC');
      expect(res.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.HUAWEI.capabilities);
      expect(res.notes).toEqual(CPE_IPV6_CAPABILITY_PROFILES.HUAWEI.notes);
    });

    it('resuelve el perfil HUAWEI por modelo HG8546M aunque el vendor esté vacío', () => {
      const res = resolveCpeIpv6Capabilities(undefined, 'HG8546M-XPON');
      expect(res.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.HUAWEI.capabilities);
      expect(res.notes.staticIpv6).toContain('WANIPConnection');
    });

    it('resuelve el perfil ZTE cuando el vendor es ZTE', () => {
      const res = resolveCpeIpv6Capabilities('ZTE');
      expect(res.capabilities.pppoeDualStack).toBe(true);
      expect(res.capabilities.pppoePrefixReadback).toBe(true);
      expect(res.capabilities.dhcpDualStack).toBe(false);
      expect(res.notes.dhcpDualStack).toContain('ZTE');
    });

    it('resuelve el perfil ZTE por modelo F670', () => {
      const res = resolveCpeIpv6Capabilities(undefined, 'ZXHN F670L');
      expect(res.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.ZTE.capabilities);
    });

    it('resuelve el perfil TR181 cuando isTR181 es true, independientemente del vendor', () => {
      const res = resolveCpeIpv6Capabilities('HUAWEI', 'HG8546M', true);
      expect(res.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.TR181.capabilities);
      expect(res.capabilities.dhcpDualStack).toBe(true);
      expect(res.capabilities.staticIpv6).toBe(true);
    });

    it('resuelve el perfil GENERIC_TR098 cuando el vendor y modelo son desconocidos o vacíos', () => {
      const resEmpty = resolveCpeIpv6Capabilities();
      expect(resEmpty.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.GENERIC_TR098.capabilities);

      const resUnknown = resolveCpeIpv6Capabilities('Desconocido', 'ModelX');
      expect(resUnknown.capabilities).toEqual(CPE_IPV6_CAPABILITY_PROFILES.GENERIC_TR098.capabilities);
      expect(resUnknown.notes.dhcpDualStack).toContain('TR-098 estándar');
    });

    it('todas las capabilities en false incluyen un motivo descriptivo en notes', () => {
      const profiles = Object.values(CPE_IPV6_CAPABILITY_PROFILES);
      for (const profile of profiles) {
        expect(profile.capabilities.pppoeDualStack).toBe(true);
        expect(profile.capabilities.pppoePrefixReadback).toBe(true);

        if (!profile.capabilities.dhcpDualStack) {
          expect(profile.notes.dhcpDualStack).toBeDefined();
          expect(typeof profile.notes.dhcpDualStack).toBe('string');
        }
        if (!profile.capabilities.staticIpv6) {
          expect(profile.notes.staticIpv6).toBeDefined();
          expect(typeof profile.notes.staticIpv6).toBe('string');
        }
      }
    });
  });
});
