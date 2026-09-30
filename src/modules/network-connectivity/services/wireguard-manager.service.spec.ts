import { WireguardManagerService } from './wireguard-manager.service';

describe('WireguardManagerService', () => {
  let service: WireguardManagerService;

  beforeEach(() => {
    service = new WireguardManagerService();
  });

  it('debe generar pares de claves Curve25519 en formato Base64', () => {
    const keys = service.generateKeyPair();
    expect(keys.privateKey).toBeDefined();
    expect(keys.publicKey).toBeDefined();
    expect(keys.publicKey.length).toBeGreaterThan(40);
    expect(keys.privateKey.length).toBeGreaterThan(40);
  });

  it('debe generar el script RouterOS .rsc con los comandos e IPs correctas', () => {
    const res = service.generateRouterOsScript({
      nodeName: 'Router-Azua-Centro',
      nodeId: 'node-123',
      tenantSlug: 'teleazua',
      assignedClientIp: '10.254.1.2',
      serverEndpoint: 'vpn.sumtech.com.do',
      serverPort: 51820,
      serverPublicKey: 'SERVER_PUB_KEY_123=',
      clientPublicKey: 'CLIENT_PUB_KEY_456=',
      allowedIps: '10.254.0.0/16',
      keepaliveSeconds: 25,
    });

    expect(res.clientIp).toEqual('10.254.1.2');
    expect(res.serverEndpoint).toEqual('vpn.sumtech.com.do:51820');
    expect(res.routerosScript).toContain('/interface wireguard');
    expect(res.routerosScript).toContain('wg-sumtech');
    expect(res.routerosScript).toContain('address="10.254.1.2/30"');
    expect(res.routerosScript).toContain('public-key="SERVER_PUB_KEY_123="');
    expect(res.routerosScript).toContain('persistent-keepalive=25s');
  });
});
