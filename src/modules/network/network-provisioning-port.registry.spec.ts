import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';
import { OltNativeProvisioningAdapter } from './olt-native-provisioning.adapter';
import { DhcpProvisioningAdapter } from './dhcp-provisioning.adapter';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { NetworkNodeEntity } from './entities/network-node.entity';

describe('NetworkProvisioningPortRegistry', () => {
  const manualAdapter = new ManualProvisioningAdapter();
  const routerOsAdapter = {} as RouterOsProvisioningAdapter;
  const oltNativeAdapter = {} as OltNativeProvisioningAdapter;
  const dhcpAdapter = {} as DhcpProvisioningAdapter;
  const registry = new NetworkProvisioningPortRegistry(manualAdapter, routerOsAdapter, oltNativeAdapter, dhcpAdapter);

  it('devuelve el adaptador RouterOS cuando el modo es ROUTEROS', () => {
    expect(registry.resolve('ROUTEROS')).toBe(routerOsAdapter);
  });

  it('devuelve el adaptador manual cuando el modo es MANUAL', () => {
    expect(registry.resolve('MANUAL')).toBe(manualAdapter);
  });

  it('devuelve el adaptador manual por defecto cuando el modo no está definido', () => {
    expect(registry.resolve(undefined)).toBe(manualAdapter);
  });

  describe('resolveSuspensionMedium (RF-RED-001/002)', () => {
    it('prioridad 1: respeta suspensionMediumOverride si está presente', () => {
      const access = {
        suspensionMediumOverride: 'OLT_NATIVE',
        node: { suspensionMedium: 'PPPOE' } as NetworkNodeEntity,
      } as NetworkAccessEntity;

      expect(registry.resolveSuspensionMedium(access)).toBe('OLT_NATIVE');
    });

    it('prioridad 2: usa el suspensionMedium del nodo si no hay override', () => {
      const access = {
        nodeId: 'node-1',
        node: { suspensionMedium: 'OLT_NATIVE' } as NetworkNodeEntity,
      } as NetworkAccessEntity;

      expect(registry.resolveSuspensionMedium(access)).toBe('OLT_NATIVE');
    });

    it('prioridad 3: resuelve OLT_NATIVE si no hay nodo pero sí ONU vinculada', () => {
      const access = {
        onuId: 'onu-1',
      } as NetworkAccessEntity;

      expect(registry.resolveSuspensionMedium(access)).toBe('OLT_NATIVE');
    });

    it('prioridad 4: resuelve PPPOE si hay nodo configurado', () => {
      const access = {
        nodeId: 'node-1',
      } as NetworkAccessEntity;

      expect(registry.resolveSuspensionMedium(access)).toBe('PPPOE');
    });

    it('devuelve NONE si no hay nodo ni ONU', () => {
      const access = {} as NetworkAccessEntity;

      expect(registry.resolveSuspensionMedium(access)).toBe('NONE');
    });

    it('respeta override DHCP', () => {
      const access = { suspensionMediumOverride: 'DHCP' } as NetworkAccessEntity;
      expect(registry.resolveSuspensionMedium(access)).toBe('DHCP');
    });

    it('usa el suspensionMedium DHCP del nodo si no hay override', () => {
      const access = { nodeId: 'node-1', node: { suspensionMedium: 'DHCP' } as NetworkNodeEntity } as NetworkAccessEntity;
      expect(registry.resolveSuspensionMedium(access)).toBe('DHCP');
    });
  });

  describe('resolveForAccess', () => {
    it('devuelve oltNativeAdapter cuando el medio efectivo es OLT_NATIVE', () => {
      const access = {
        onuId: 'onu-1',
      } as NetworkAccessEntity;

      expect(registry.resolveForAccess(access)).toBe(oltNativeAdapter);
    });

    it('devuelve routerOsAdapter cuando el medio es PPPOE y el nodo es ROUTEROS', () => {
      const access = {
        nodeId: 'node-1',
        node: { suspensionMedium: 'PPPOE', provisioningMode: 'ROUTEROS' } as NetworkNodeEntity,
      } as NetworkAccessEntity;

      expect(registry.resolveForAccess(access)).toBe(routerOsAdapter);
    });

    it('devuelve manualAdapter cuando el medio es PPPOE y el nodo es MANUAL', () => {
      const access = {
        nodeId: 'node-1',
        node: { suspensionMedium: 'PPPOE', provisioningMode: 'MANUAL' } as NetworkNodeEntity,
      } as NetworkAccessEntity;

      expect(registry.resolveForAccess(access)).toBe(manualAdapter);
    });

    it('devuelve dhcpAdapter cuando el medio efectivo es DHCP, sin importar el provisioningMode del nodo', () => {
      const access = {
        nodeId: 'node-1',
        node: { suspensionMedium: 'DHCP', provisioningMode: 'MANUAL' } as NetworkNodeEntity,
      } as NetworkAccessEntity;

      expect(registry.resolveForAccess(access)).toBe(dhcpAdapter);
    });
  });
});
