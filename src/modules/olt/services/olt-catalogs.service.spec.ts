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

import { PlanEntity } from '../../plans/entities/plan.entity';

describe('OltCatalogsService', () => {
  let service: OltCatalogsService;
  let vlanRepo: any;
  let ifaceVlanRepo: any;
  let tr069Repo: any;
  let speedProfileRepo: any;
  let planRepo: any;

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
    speedProfileRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'prof-new', ...dto })),
      save: jest.fn((dto) => Promise.resolve(dto)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    planRepo = {
      count: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltCatalogsService,
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: {} },
        { provide: getRepositoryToken(OltInterfaceVlanEntity), useValue: ifaceVlanRepo },
        { provide: getRepositoryToken(OltSpeedProfileEntity), useValue: speedProfileRepo },
        { provide: getRepositoryToken(OnuTypeEntity), useValue: {} },
        { provide: getRepositoryToken(Tr069NetworkEntity), useValue: tr069Repo },
        { provide: getRepositoryToken(OltEntity), useValue: {} },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
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

  describe('SpeedProfiles CRUD (RF-OLT-008)', () => {
    it('crea un perfil de velocidad OLT con T-CONT por defecto si no se especifica', async () => {
      speedProfileRepo.findOneBy.mockResolvedValue(null);

      const res = await service.createSpeedProfile({
        code: 'OLT-30M',
        name: 'Perfil OLT 30 Mbps Simétrico',
        downKbps: 30720,
        upKbps: 30720,
      });

      expect(res.code).toBe('OLT-30M');
      expect(res.vendorTcontProfile).toBe('TCONT-30M');
      expect(res.vendorTrafficProfile).toBe('TRAFFIC-30M');
      expect(speedProfileRepo.save).toHaveBeenCalled();
    });

    it('rechaza la creación si el código de perfil OLT ya existe', async () => {
      speedProfileRepo.findOneBy.mockResolvedValue({ id: 'p1', code: 'OLT-30M' });

      await expect(
        service.createSpeedProfile({
          code: 'OLT-30M',
          name: 'Duplicado',
          downKbps: 30720,
          upKbps: 30720,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('actualiza un perfil OLT existente', async () => {
      const existing = {
        id: 'p1',
        code: 'OLT-30M',
        name: 'Original',
        downKbps: 30720,
        upKbps: 30720,
        vendorTcontProfile: 'TCONT-30M',
        vendorTrafficProfile: 'TRAFFIC-30M',
        isActive: true,
      };
      speedProfileRepo.findOneBy.mockResolvedValue(existing);

      const res = await service.updateSpeedProfile('p1', {
        name: 'Actualizado',
        downKbps: 40960,
      });

      expect(res.name).toBe('Actualizado');
      expect(res.downKbps).toBe(40960);
      expect(speedProfileRepo.save).toHaveBeenCalled();
    });

    it('prohíbe eliminar un perfil OLT si está asignado a planes comerciales', async () => {
      speedProfileRepo.findOneBy.mockResolvedValue({ id: 'p1', name: 'Perfil 50M' });
      planRepo.count.mockResolvedValue(2);

      await expect(service.deleteSpeedProfile('p1')).rejects.toThrow(
        /No se puede eliminar el perfil OLT.*asignado a 2 plan\(es\)/,
      );
    });

    it('elimina un perfil OLT si no tiene planes comerciales vinculados', async () => {
      speedProfileRepo.findOneBy.mockResolvedValue({ id: 'p1', name: 'Perfil Libre' });
      planRepo.count.mockResolvedValue(0);

      const res = await service.deleteSpeedProfile('p1');

      expect(res.success).toBe(true);
      expect(speedProfileRepo.delete).toHaveBeenCalledWith('p1');
    });
  });
});

