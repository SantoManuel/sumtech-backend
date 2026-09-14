import { NetworkProvisioningPortRegistry } from './network-provisioning-port.registry';
import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { RouterOsProvisioningAdapter } from './routeros-provisioning.adapter';

describe('NetworkProvisioningPortRegistry', () => {
  const manualAdapter = new ManualProvisioningAdapter();
  const routerOsAdapter = {} as RouterOsProvisioningAdapter;
  const registry = new NetworkProvisioningPortRegistry(manualAdapter, routerOsAdapter);

  it('devuelve el adaptador RouterOS cuando el modo es ROUTEROS', () => {
    expect(registry.resolve('ROUTEROS')).toBe(routerOsAdapter);
  });

  it('devuelve el adaptador manual cuando el modo es MANUAL', () => {
    expect(registry.resolve('MANUAL')).toBe(manualAdapter);
  });

  it('devuelve el adaptador manual por defecto cuando el modo no está definido (acceso sin nodo asignado)', () => {
    expect(registry.resolve(undefined)).toBe(manualAdapter);
  });
});
