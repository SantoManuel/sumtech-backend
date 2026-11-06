import { AuthorizeOnuParams } from '../ports/olt-driver.port';
import { isTr069TransportAlreadyApplied, isTr069ManagementAlreadyApplied } from './zte-c320-provisioning-scripts';

/**
 * Casos de "ya aplicado" para la Etapa 2 (Aplicar Perfil TR-069). Las
 * salidas RAW de `baseManagementRaw`/`baseTransportRaw` son textuales --
 * copiadas tal cual de "show onu running config gpon-onu_1/3/1:3" y "show
 * running-config interface gpon-onu_1/3/1:3" contra OLT_Tabara_Abajo,
 * ONU gpon-onu_1/3/1:3 (2026-11-06) -- el caso real que reveló que
 * "Aplicar Perfil TR-069" reenviaba y tumbaba un canal ya correcto y vivo.
 */
describe('isTr069TransportAlreadyApplied / isTr069ManagementAlreadyApplied', () => {
  const config: AuthorizeOnuParams = {
    ponInterface: 'gpon-olt_1/3/1',
    onuId: 3,
    modelTypeName: 'HUAWEY-HG8145V5',
    serialNumber: 'TEST00000003',
    serviceVlan: 700,
    managementMethod: 'TR069',
    operationMode: 'ROUTER',
    tr069Url: 'http://10.46.69.1:7547',
    tr069Vlan: 444,
  };

  const baseTransportRaw = [
    'interface gpon-onu_1/3/1:3',
    '  name ONU-3',
    '  description zone_Azua-Centro_authd_20261106',
    '  sn-bind enable sn',
    '  tcont 1 profile UP-25M',
    '  tcont 2 profile SMARTOLT-VOIPMNG-10M',
    '  gemport 1 tcont 1',
    '  gemport 1 traffic-limit downstream SMARTOLT-1G-DOWN',
    '  gemport 2 tcont 2',
    '  gemport 2 traffic-limit downstream SMARTOLT-VOIPMNG-10M',
    '  service-port 1 vport 1 user-vlan 700 vlan 700',
    '  service-port 2 vport 2 user-vlan 444 vlan 444',
    '  traffic-profile TRAFFIC-25M vport 1 direction egress',
    '!',
  ].join('\r\n');

  const baseManagementRaw = [
    'pon-onu-mng gpon-onu_1/3/1:3',
    '  flow 2 switch switch_0/1',
    '  flow mode 1 tag-filter vlan-filter untag-filter discard',
    '  flow mode 2 tag-filter vlan-filter untag-filter discard',
    '  flow 1 pri 0 vlan 700',
    '  flow 2 pri 2 vlan 444',
    '  gemport 1 flow 1',
    '  gemport 2 flow 2',
    '  switchport-bind switch_0/1 iphost 1',
    '  switchport-bind switch_0/1 iphost 2',
    '  ip-host 2 dhcp-enable enable ping-response enable traceroute-response enable',
    '  vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard',
    '  vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard',
    '  vlan-filter iphost 1 pri 0 vlan 700',
    '  vlan-filter iphost 2 pri 2 vlan 444',
    '  dhcp-ip ethuni eth_0/1 from-onu',
    '  dhcp-ip ethuni eth_0/2 from-onu',
    '  dhcp-ip ethuni eth_0/3 from-onu',
    '  dhcp-ip ethuni eth_0/4 from-onu',
    '  tr069-mgmt 1 state unlock',
    '  tr069-mgmt 1 acs http://10.46.69.1:7547',
    '  tr069-mgmt 1 tag pri 2 vlan 444',
    '  security-mgmt 998 state enable mode forward ingress-type lan protocol web https',
    '  security-mgmt 999 state enable ingress-type lan protocol tr069',
    '!',
  ].join('\r\n');

  describe('transporte (tcont 2/gemport 2/service-port 2)', () => {
    it('reconoce el bloque real ya aplicado y devuelve true', () => {
      expect(isTr069TransportAlreadyApplied(baseTransportRaw, config)).toBe(true);
    });

    it('devuelve false si la VLAN del service-port real difiere de la deseada', () => {
      const raw = baseTransportRaw.replace('service-port 2 vport 2 user-vlan 444 vlan 444', 'service-port 2 vport 2 user-vlan 46 vlan 46');
      expect(isTr069TransportAlreadyApplied(raw, config)).toBe(false);
    });

    it('devuelve false si falta una línea objetivo (gemport 2 nunca se creó)', () => {
      const raw = baseTransportRaw.split('\r\n').filter(line => !line.includes('gemport 2 tcont 2')).join('\r\n');
      expect(isTr069TransportAlreadyApplied(raw, config)).toBe(false);
    });

    it('nunca asume aplicado ante una lectura vacía, indefinida o de error -- mismo comportamiento que hoy, nunca peor', () => {
      expect(isTr069TransportAlreadyApplied('', config)).toBe(false);
      expect(isTr069TransportAlreadyApplied(undefined, config)).toBe(false);
      expect(isTr069TransportAlreadyApplied('%Error 20200: Invalid input detected at \'^\' marker', config)).toBe(false);
      expect(isTr069TransportAlreadyApplied('%Code 64040-GPONRM : No relate information to show', config)).toBe(false);
    });

    it('no revienta si el config no puede generar el script (datos faltantes) -- devuelve false en vez de propagar la excepción', () => {
      expect(isTr069TransportAlreadyApplied(baseTransportRaw, { ...config, tr069Vlan: undefined })).toBe(false);
    });
  });

  describe('gestión OMCI (flow 2/switchport-bind/ip-host 2/tr069-mgmt/security-mgmt)', () => {
    it('reconoce el bloque real ya aplicado y devuelve true -- caso real que tumbaba el canal de gestión en cada reintento', () => {
      expect(isTr069ManagementAlreadyApplied(baseManagementRaw, config)).toBe(true);
    });

    it('devuelve false si el tag de tr069-mgmt apunta a otra VLAN', () => {
      const raw = baseManagementRaw.replace('tr069-mgmt 1 tag pri 2 vlan 444', 'tr069-mgmt 1 tag pri 2 vlan 46');
      expect(isTr069ManagementAlreadyApplied(raw, config)).toBe(false);
    });

    it('devuelve false si el ACS configurado es distinto', () => {
      const raw = baseManagementRaw.replace('tr069-mgmt 1 acs http://10.46.69.1:7547', 'tr069-mgmt 1 acs http://otro-acs.example.com:7547');
      expect(isTr069ManagementAlreadyApplied(raw, config)).toBe(false);
    });

    it('devuelve false si falta el switchport-bind de iphost 2 (ej. nunca se enlazó)', () => {
      const raw = baseManagementRaw.split('\r\n').filter(line => !line.includes('switchport-bind switch_0/1 iphost 2')).join('\r\n');
      expect(isTr069ManagementAlreadyApplied(raw, config)).toBe(false);
    });

    it('con credenciales ACS configuradas, exige la cláusula "validate basic" exacta', () => {
      const configWithCreds: AuthorizeOnuParams = { ...config, tr069AcsUsername: 'acsuser', tr069AcsPassword: 'acspass' };
      const rawSinCreds = baseManagementRaw; // todavía con la línea de ACS sin credenciales
      expect(isTr069ManagementAlreadyApplied(rawSinCreds, configWithCreds)).toBe(false);

      const rawConCreds = baseManagementRaw.replace(
        'tr069-mgmt 1 acs http://10.46.69.1:7547',
        'tr069-mgmt 1 acs http://10.46.69.1:7547 validate basic username acsuser password acspass',
      );
      expect(isTr069ManagementAlreadyApplied(rawConCreds, configWithCreds)).toBe(true);
    });

    it('nunca asume aplicado ante una lectura vacía, indefinida o de error', () => {
      expect(isTr069ManagementAlreadyApplied('', config)).toBe(false);
      expect(isTr069ManagementAlreadyApplied(undefined, config)).toBe(false);
      expect(isTr069ManagementAlreadyApplied('%Error 20200: Invalid input detected at \'^\' marker', config)).toBe(false);
    });

    it('no revienta si falta tr069Url -- devuelve false en vez de propagar la excepción de generateTr069ManagementScript', () => {
      expect(isTr069ManagementAlreadyApplied(baseManagementRaw, { ...config, tr069Url: undefined })).toBe(false);
    });

    it('ignora mayúsculas/espacios de indentación variables entre OLTs', () => {
      const rawConEspacios = baseManagementRaw.split('\r\n').map(line => `    ${line.trim()}   `).join('\n');
      expect(isTr069ManagementAlreadyApplied(rawConEspacios, config)).toBe(true);
    });
  });
});
