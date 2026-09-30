import { OltNativeProvisioningAdapter } from './olt-native-provisioning.adapter';
import { NetworkAccessEntity } from './entities/network-access.entity';
import { OnuManagementService } from '../olt/services/onu-management.service';

describe('OltNativeProvisioningAdapter', () => {
  let adapter: OltNativeProvisioningAdapter;
  let onuService: Partial<Record<keyof OnuManagementService, jest.Mock>>;

  beforeEach(() => {
    onuService = {
      blockOnu: jest.fn().mockResolvedValue({ success: true, status: 'BLOCKED' }),
      unblockOnu: jest.fn().mockResolvedValue({ success: true, status: 'ACTIVE' }),
    };

    adapter = new OltNativeProvisioningAdapter(onuService as any);
  });

  it('debe estar definido', () => {
    expect(adapter).toBeDefined();
  });

  describe('suspend', () => {
    it('bloquea la ONU asociada al contrato cuando el medio es OLT Nativo', async () => {
      const access = {
        id: 'acc-1',
        contractId: 'contract-1',
        onuId: 'onu-uuid-123',
      } as NetworkAccessEntity;

      const result = await adapter.suspend(access);

      expect(result.ok).toBe(true);
      expect(onuService.blockOnu).toHaveBeenCalledWith('onu-uuid-123');
    });

    it('falla con mensaje descriptivo si el acceso no tiene una ONU vinculada', async () => {
      const access = {
        id: 'acc-1',
        contractId: 'contract-1',
      } as NetworkAccessEntity;

      const result = await adapter.suspend(access);

      expect(result.ok).toBe(false);
      expect(result.error).toContain('requiere una ONU vinculada');
      expect(onuService.blockOnu).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('restaura y reactiva el tráfico de la ONU en la OLT', async () => {
      const access = {
        id: 'acc-1',
        contractId: 'contract-1',
        onuId: 'onu-uuid-123',
      } as NetworkAccessEntity;

      const result = await adapter.restore(access);

      expect(result.ok).toBe(true);
      expect(onuService.unblockOnu).toHaveBeenCalledWith('onu-uuid-123');
    });
  });

  describe('syncProfile', () => {
    it('retorna ok:true', async () => {
      const access = { id: 'acc-1', contractId: 'contract-1' } as NetworkAccessEntity;
      const res = await adapter.syncProfile(access, { name: 'PLAN-50M', rateLimitMbps: 50 });
      expect(res.ok).toBe(true);
    });
  });
});
