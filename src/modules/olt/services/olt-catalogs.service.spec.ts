import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OltCatalogsService } from './olt-catalogs.service';
import { VlanEntity } from '../entities/vlan.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OltInterfaceVlanEntity } from '../entities/olt-interface-vlan.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { OltEntity } from '../entities/olt.entity';
import { ZteC320Driver } from '../drivers/zte-c320.driver';

describe('OltCatalogsService', () => {
  let service: OltCatalogsService;
  let vlanRepo: any;
  let ifaceVlanRepo: any;
  let tr069Repo: any;

  beforeEach(async () => {
    vlanRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ id: 'vlan-1', ...dto })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    ifaceVlanRepo = {
      count: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };
    tr069Repo = {
      count: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltCatalogsService,
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: {} },
        { provide: getRepositoryToken(OltInterfaceVlanEntity), useValue: ifaceVlanRepo },
        { provide: getRepositoryToken(OltSpeedProfileEntity), useValue: {} },
        { provide: getRepositoryToken(OnuTypeEntity), useValue: {} },
        { provide: getRepositoryToken(Tr069NetworkEntity), useValue: tr069Repo },
        { provide: getRepositoryToken(OltEntity), useValue: {} },
        { provide: ZteC320Driver, useValue: { configureVlanOnInterface: jest.fn() } },
      ],
    }).compile();

    service = module.get<OltCatalogsService>(OltCatalogsService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('createVlan', () => {
    it('crea la VLAN si el vlanId no existe previamente', async () => {
      vlanRepo.findOneBy.mockResolvedValue(null);

      const res = await service.createVlan({ vlanId: 100, name: 'VLAN-Internet', type: 'INTERNET' });

      expect(res.vlanId).toBe(100);
      expect(vlanRepo.save).toHaveBeenCalled();
    });

    it('lanza BadRequestException si el vlanId ya existe', async () => {
      vlanRepo.findOneBy.mockResolvedValue({ id: 'v1', vlanId: 100, name: 'Existente' });

      await expect(service.createVlan({ vlanId: 100, name: 'Duplicada' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteVlan (RF-OLT-011)', () => {
    it('prohíbe el borrado si la VLAN está asignada a interfaces de OLT', async () => {
      ifaceVlanRepo.count.mockResolvedValue(3);

      await expect(service.deleteVlan('vlan-1')).rejects.toThrow(
        /No se puede eliminar la VLAN: está asignada a 3 interfaces/,
      );
    });

    it('prohíbe el borrado si la VLAN está asociada a una red TR-069', async () => {
      ifaceVlanRepo.count.mockResolvedValue(0);
      tr069Repo.count.mockResolvedValue(1);

      await expect(service.deleteVlan('vlan-1')).rejects.toThrow(/vinculada a una red TR-069/);
    });

    it('elimina la VLAN si no tiene dependencias', async () => {
      ifaceVlanRepo.count.mockResolvedValue(0);
      tr069Repo.count.mockResolvedValue(0);

      const res = await service.deleteVlan('vlan-1');

      expect(res.success).toBe(true);
      expect(vlanRepo.delete).toHaveBeenCalledWith('vlan-1');
    });
  });
});
