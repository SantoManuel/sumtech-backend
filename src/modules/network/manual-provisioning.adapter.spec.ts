import { ManualProvisioningAdapter } from './manual-provisioning.adapter';
import { NetworkAccessEntity } from './entities/network-access.entity';

describe('ManualProvisioningAdapter', () => {
  let adapter: ManualProvisioningAdapter;

  const access = { id: 'access-1', contractId: 'contract-1' } as NetworkAccessEntity;

  beforeEach(() => {
    adapter = new ManualProvisioningAdapter();
  });

  it('provision siempre tiene éxito sin llamar a ningún sistema externo', async () => {
    await expect(adapter.provision(access)).resolves.toEqual({ ok: true });
  });

  it('suspend siempre tiene éxito', async () => {
    await expect(adapter.suspend(access)).resolves.toEqual({ ok: true });
  });

  it('restore siempre tiene éxito', async () => {
    await expect(adapter.restore(access)).resolves.toEqual({ ok: true });
  });

  it('deprovision siempre tiene éxito', async () => {
    await expect(adapter.deprovision(access)).resolves.toEqual({ ok: true });
  });

  it('syncProfile siempre tiene éxito sin llamar a ningún sistema externo', async () => {
    await expect(adapter.syncProfile(access, { name: 'Sumtech-50Mbps', rateLimitMbps: 50 })).resolves.toEqual({
      ok: true,
    });
  });
});
