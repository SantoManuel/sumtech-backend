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
      clientPrivateKey: 'CLIENT_PRIV_KEY_789=',
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
    expect(res.routerosScript).toContain('private-key="CLIENT_PRIV_KEY_789="');
    expect(res.hubPeerCommand).toEqual('wg set wg0 peer CLIENT_PUB_KEY_456= allowed-ips 10.254.1.2/32');
  });

  it('debe habilitar el servicio correcto segun el transportType del nodo', () => {
    const base = {
      nodeName: 'Router-Azua-Centro',
      nodeId: 'node-123',
      tenantSlug: 'teleazua',
      assignedClientIp: '10.254.1.2',
      serverEndpoint: 'vpn.sumtech.com.do',
      serverPublicKey: 'SERVER_PUB_KEY_123=',
      clientPrivateKey: 'CLIENT_PRIV_KEY_789=',
      clientPublicKey: 'CLIENT_PUB_KEY_456=',
    };

    const ssh = service.generateRouterOsScript({ ...base, transportType: 'SSH' });
    expect(ssh.routerosScript).toContain('local svcName "ssh"');

    const binary = service.generateRouterOsScript({ ...base, transportType: 'ROUTEROS_API', useHttps: true });
    expect(binary.routerosScript).toContain('local svcName "api-ssl"');

    const rest = service.generateRouterOsScript({ ...base, transportType: 'REST', useHttps: false });
    expect(rest.routerosScript).toContain('local svcName "www"');
  });

  it('no debe sobreescribir el address-list del servicio, solo añadir la subred del tunel', () => {
    const res = service.generateRouterOsScript({
      nodeName: 'Router-Azua-Centro',
      nodeId: 'node-123',
      tenantSlug: 'teleazua',
      assignedClientIp: '10.254.1.2',
      serverEndpoint: 'vpn.sumtech.com.do',
      serverPublicKey: 'SERVER_PUB_KEY_123=',
      clientPrivateKey: 'CLIENT_PRIV_KEY_789=',
      clientPublicKey: 'CLIENT_PUB_KEY_456=',
      allowedIps: '10.254.0.0/16',
    });

    expect(res.routerosScript).toContain('($currentAddr . "," . $tunnelCidr)');
    expect(res.routerosScript).toContain('in-interface="wg-sumtech" action=accept');
  });

  it('referencia /ip service directamente por nombre, sin "find name=" (RouterOS lo rechaza con "no such item")', () => {
    const res = service.generateRouterOsScript({
      nodeName: 'Router-Azua-Centro',
      nodeId: 'node-123',
      tenantSlug: 'teleazua',
      assignedClientIp: '10.254.1.2',
      serverEndpoint: 'vpn.sumtech.com.do',
      serverPublicKey: 'SERVER_PUB_KEY_123=',
      clientPrivateKey: 'CLIENT_PRIV_KEY_789=',
      clientPublicKey: 'CLIENT_PUB_KEY_456=',
    });

    expect(res.routerosScript).toContain('[get $svcName address]');
    expect(res.routerosScript).toContain('set $svcName disabled=no');
    expect(res.routerosScript).not.toContain('find name=$svcName');
  });

  it('no incluye caracteres acentuados en el contenido del .rsc (riesgo de mojibake en terminales RouterOS)', () => {
    const res = service.generateRouterOsScript({
      nodeName: 'Router-Azua-Centro',
      nodeId: 'node-123',
      tenantSlug: 'teleazua',
      assignedClientIp: '10.254.1.2',
      serverEndpoint: 'vpn.sumtech.com.do',
      serverPublicKey: 'SERVER_PUB_KEY_123=',
      clientPrivateKey: 'CLIENT_PRIV_KEY_789=',
      clientPublicKey: 'CLIENT_PUB_KEY_456=',
    });

    // eslint-disable-next-line no-control-regex
    expect(/[^\x00-\x7F]/.test(res.routerosScript)).toBe(false);
  });
});
