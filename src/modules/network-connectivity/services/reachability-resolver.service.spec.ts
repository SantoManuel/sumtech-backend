import { ReachabilityResolver } from './reachability-resolver.service';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';

describe('ReachabilityResolver', () => {
  let resolver: ReachabilityResolver;

  beforeEach(() => {
    resolver = new ReachabilityResolver();
  });

  describe('isPrivateIp', () => {
    it('detecta correctamente direcciones privadas RFC 1918 y loopback', () => {
      expect(resolver.isPrivateIp('10.0.0.1')).toBe(true);
      expect(resolver.isPrivateIp('10.254.1.1')).toBe(true);
      expect(resolver.isPrivateIp('172.16.0.1')).toBe(true);
      expect(resolver.isPrivateIp('172.31.255.254')).toBe(true);
      expect(resolver.isPrivateIp('192.168.1.1')).toBe(true);
      expect(resolver.isPrivateIp('127.0.0.1')).toBe(true);

      // IPs públicas
      expect(resolver.isPrivateIp('8.8.8.8')).toBe(false);
      expect(resolver.isPrivateIp('1.1.1.1')).toBe(false);
      expect(resolver.isPrivateIp('200.50.100.2')).toBe(false);
      expect(resolver.isPrivateIp('172.32.0.1')).toBe(false);
    });
  });

  describe('resolveEndpoint', () => {
    it('resuelve endpoint WireGuard usando wireguardIp', async () => {
      const node = {
        name: 'Node-WG',
        connectionMethod: 'wireguard',
        wireguardIp: '10.254.1.2',
        apiPort: 443,
        useHttps: true,
      } as NetworkNodeEntity;

      const endpoint = await resolver.resolveEndpoint(node);
      expect(endpoint.host).toBe('10.254.1.2');
      expect(endpoint.port).toBe(443);
      expect(endpoint.useHttps).toBe(true);
      expect(endpoint.resolvedVia).toBe('WIREGUARD');
    });

    it('emite advertencia si método es public_ip pero la IP es privada RFC 1918', async () => {
      const node = {
        name: 'Node-Pub-Warning',
        connectionMethod: 'public_ip',
        managementIp: '192.168.1.1',
        apiPort: 80,
        useHttps: false,
      } as NetworkNodeEntity;

      const endpoint = await resolver.resolveEndpoint(node);
      expect(endpoint.host).toBe('192.168.1.1');
      expect(endpoint.port).toBe(80);
      expect(endpoint.useHttps).toBe(false);
      expect(endpoint.warning).toContain('RFC 1918');
    });

    it('resuelve directo para método api usando managementIp', async () => {
      const node = {
        name: 'Node-API',
        connectionMethod: 'api',
        managementIp: '200.50.100.5',
        apiPort: 8728,
        useHttps: false,
      } as NetworkNodeEntity;

      const endpoint = await resolver.resolveEndpoint(node);
      expect(endpoint.host).toBe('200.50.100.5');
      expect(endpoint.port).toBe(8728);
      expect(endpoint.resolvedVia).toBe('DIRECT');
      expect(endpoint.warning).toBeUndefined();
    });
  });
});
