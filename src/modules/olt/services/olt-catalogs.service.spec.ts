import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OltCatalogsService } from './olt-catalogs.service';
import { VlanEntity } from '../entities/vlan.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OltInterfaceVlanEntity } from '../entities/olt-interface-vlan.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { OnuEntity } from '../entities/onu.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { UnknownOltVendorError } from '../ports/olt-driver.port';

import { PlanEntity } from '../../plans/entities/plan.entity';

describe('OltCatalogsService', () => {
  let service: OltCatalogsService;
  let vlanRepo: any;
  let ifaceRepo: any;
  let ifaceVlanRepo: any;
  let tr069Repo: any;
  let speedProfileRepo: any;
  let onuTypeRepo: any;
  let onuRepo: any;
  let planRepo: any;
  let driverRegistry: any;
  let oltRepo: any;
  let connectionResolver: any;

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
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
    };
    tr069Repo = {
      count: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve(dto)),
      delete: jest.fn(),
    };
    speedProfileRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'prof-new', ...dto })),
      save: jest.fn((dto) => Promise.resolve(dto)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    onuTypeRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((dto) => ({ id: 'onu-type-new', ...dto })),
      save: jest.fn((dto) => Promise.resolve(dto)),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    onuRepo = {
      count: jest.fn(),
    };
    planRepo = {
      count: jest.fn(),
    };
    ifaceRepo = {
      findOne: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    oltRepo = {
      findOneBy: jest.fn(),
    };
    driverRegistry = {
      resolve: jest.fn().mockReturnValue({
        configureVlanOnInterface: jest.fn().mockResolvedValue({ ok: true }),
        setInterfaceAdminState: jest.fn().mockResolvedValue({ ok: true }),
        ensureTcontProfile: jest.fn().mockResolvedValue({ ok: true }),
      }),
    };
    // Por defecto se comporta como una OLT DIRECT (host/port tal cual) --
    // las pruebas de VIA_MIKROTIK lo sobreescriben explícitamente para
    // probar que el servicio usa lo que devuelve el resolver, no los
    // campos crudos de la OLT (ver olt-connection-resolver.service.ts).
    connectionResolver = {
      resolve: jest.fn((olt: any) =>
        Promise.resolve({ host: olt.host, port: olt.port, username: olt.username, password: 'decrypted-password' }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OltCatalogsService,
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: ifaceRepo },
        { provide: getRepositoryToken(OltInterfaceVlanEntity), useValue: ifaceVlanRepo },
        { provide: getRepositoryToken(OltSpeedProfileEntity), useValue: speedProfileRepo },
        { provide: getRepositoryToken(OnuTypeEntity), useValue: onuTypeRepo },
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: getRepositoryToken(Tr069NetworkEntity), useValue: tr069Repo },
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(PlanEntity), useValue: planRepo },
        { provide: OltDriverRegistry, useValue: driverRegistry },
        { provide: OltConnectionResolverService, useValue: connectionResolver },
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

  describe('createTr069Network / updateTr069Network', () => {
    it('cifra acsPassword/connReqPassword antes de guardar y nunca los persiste en texto plano', async () => {
      await service.createTr069Network({
        name: 'Red Lab HiOSO',
        cidr: '10.15.160.0/22',
        gateway: '10.15.160.1',
        acsUrl: 'http://66.94.107.219:7547',
        acsUsername: 'acs-admin',
        acsPassword: 'plaintext-secret',
      } as any);

      expect(tr069Repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Red Lab HiOSO',
          acsUrl: 'http://66.94.107.219:7547',
          acsPasswordEnc: expect.any(String),
        }),
      );
      const saved = tr069Repo.save.mock.calls[0][0];
      expect(saved.acsPasswordEnc).not.toBe('plaintext-secret');
      expect(saved.acsPassword).toBeUndefined();
    });

    it('createTr069Network no falla si no se provee password (campos opcionales)', async () => {
      await service.createTr069Network({
        name: 'Red Lab HiOSO',
        cidr: '10.15.160.0/22',
        gateway: '10.15.160.1',
        acsUrl: 'http://66.94.107.219:7547',
      } as any);

      const saved = tr069Repo.save.mock.calls[0][0];
      expect(saved.acsPasswordEnc).toBeUndefined();
    });

    it('updateTr069Network actualiza campos y re-cifra solo si se envía un password nuevo', async () => {
      tr069Repo.findOne.mockResolvedValue({
        id: 'tr069-1',
        name: 'Red Vieja',
        acsUrl: 'http://old:7547',
        acsPasswordEnc: 'old-enc-value',
      });

      await service.updateTr069Network('tr069-1', { acsUrl: 'http://66.94.107.219:7547' } as any);

      const saved = tr069Repo.save.mock.calls[0][0];
      expect(saved.acsUrl).toBe('http://66.94.107.219:7547');
      expect(saved.acsPasswordEnc).toBe('old-enc-value'); // no se tocó, no se envió password nuevo
    });

    it('updateTr069Network lanza NotFoundException si la red no existe', async () => {
      tr069Repo.findOne.mockResolvedValue(null);
      await expect(service.updateTr069Network('nope', {} as any)).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTr069Network', () => {
    it('elimina la red TR-069 existente', async () => {
      tr069Repo.findOne.mockResolvedValue({ id: 'tr069-1', name: 'Red Lab HiOSO' });

      const res = await service.deleteTr069Network('tr069-1');

      expect(res.success).toBe(true);
      expect(tr069Repo.delete).toHaveBeenCalledWith('tr069-1');
    });

    it('lanza NotFoundException si la red no existe', async () => {
      tr069Repo.findOne.mockResolvedValue(null);
      await expect(service.deleteTr069Network('nope')).rejects.toThrow(NotFoundException);
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

  describe('OnuTypes CRUD (catálogo real, reemplaza el seed roto de la migración 064)', () => {
    it('crea un tipo de ONU GPON nuevo', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue(null);

      const res = await service.createOnuType({
        vendor: 'ZTE',
        model: 'F670L',
        vendorTypeName: 'ZTE-F670L',
        ponType: 'GPON',
      });

      expect(res.vendor).toBe('ZTE');
      expect(onuTypeRepo.save).toHaveBeenCalled();
    });

    it('rechaza la creación si ya existe el mismo fabricante+modelo', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue({ id: 'type-1', vendor: 'ZTE', model: 'F670L' });

      await expect(
        service.createOnuType({ vendor: 'ZTE', model: 'F670L', vendorTypeName: 'ZTE-F670L', ponType: 'GPON' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException al actualizar un tipo de ONU inexistente', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue(null);

      await expect(service.updateOnuType('nope', { isActive: false })).rejects.toThrow(NotFoundException);
    });

    it('actualiza un tipo de ONU existente', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue({
        id: 'type-1',
        vendor: 'ZTE',
        model: 'F670L',
        vendorTypeName: 'ZTE-F670L',
        ponType: 'GPON',
        isActive: true,
      });

      const res = await service.updateOnuType('type-1', { isActive: false });

      expect(res.isActive).toBe(false);
      expect(onuTypeRepo.save).toHaveBeenCalled();
    });

    it('rechaza renombrar un tipo de ONU a un fabricante+modelo que ya usa otro registro', async () => {
      onuTypeRepo.findOneBy
        .mockResolvedValueOnce({ id: 'type-1', vendor: 'ZTE', model: 'F670L' }) // el propio registro a editar
        .mockResolvedValueOnce({ id: 'type-2', vendor: 'Huawei', model: 'HG8245H' }); // colisión

      await expect(
        service.updateOnuType('type-1', { vendor: 'Huawei', model: 'HG8245H' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('prohíbe eliminar un tipo de ONU si hay ONUs reales asignadas', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue({ id: 'type-1', vendor: 'ZTE', model: 'F670L' });
      onuRepo.count.mockResolvedValue(3);

      await expect(service.deleteOnuType('type-1')).rejects.toThrow(
        /No se puede eliminar el tipo de ONU.*3 ONU\(s\) real\(es\)/,
      );
    });

    it('elimina un tipo de ONU si no tiene ONUs reales vinculadas', async () => {
      onuTypeRepo.findOneBy.mockResolvedValue({ id: 'type-1', vendor: 'ZTE', model: 'F670L' });
      onuRepo.count.mockResolvedValue(0);

      const res = await service.deleteOnuType('type-1');

      expect(res.success).toBe(true);
      expect(onuTypeRepo.delete).toHaveBeenCalledWith('type-1');
    });

    it('findAllOnuTypes filtra por activos por defecto, y trae todos con includeInactive', async () => {
      onuTypeRepo.find.mockResolvedValue([]);

      await service.findAllOnuTypes('GPON');
      expect(onuTypeRepo.find).toHaveBeenLastCalledWith({
        where: { ponType: 'GPON', isActive: true },
        order: { vendor: 'ASC', model: 'ASC' },
      });

      await service.findAllOnuTypes('GPON', true);
      expect(onuTypeRepo.find).toHaveBeenLastCalledWith({
        where: { ponType: 'GPON' },
        order: { vendor: 'ASC', model: 'ASC' },
      });
    });
  });

  describe('setInterfaceAdminState', () => {
    const olt = { id: 'olt-1', vendor: 'HIOSO', host: '172.16.100.5', port: 2324, username: 'admin', passwordEnc: 'enc' };
    const iface = { id: 'iface-1', name: 'ten-gigabitethernet 1/2', adminState: 'UP', olt };

    it('lanza NotFoundException si la interfaz no existe', async () => {
      ifaceRepo.findOne.mockResolvedValue(null);
      await expect(service.setInterfaceAdminState('iface-x', 'DOWN')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si la interfaz no tiene OLT asociada', async () => {
      ifaceRepo.findOne.mockResolvedValue({ ...iface, olt: undefined });
      await expect(service.setInterfaceAdminState('iface-1', 'DOWN')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el vendor de la OLT no está registrado', async () => {
      ifaceRepo.findOne.mockResolvedValue(iface);
      driverRegistry.resolve.mockImplementation(() => {
        throw new UnknownOltVendorError('RARO');
      });
      await expect(service.setInterfaceAdminState('iface-1', 'DOWN')).rejects.toThrow(BadRequestException);
    });

    it('llama driver.setInterfaceAdminState con los datos de conexión y persiste adminState', async () => {
      ifaceRepo.findOne.mockResolvedValue({ ...iface });
      const setInterfaceAdminState = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ setInterfaceAdminState });

      const result = await service.setInterfaceAdminState('iface-1', 'DOWN');

      expect(setInterfaceAdminState).toHaveBeenCalledWith(
        { host: '172.16.100.5', port: 2324, username: 'admin', password: expect.any(String) },
        'ten-gigabitethernet 1/2',
        'DOWN',
      );
      expect(result.adminState).toBe('DOWN');
      expect(ifaceRepo.save).toHaveBeenCalledWith(expect.objectContaining({ adminState: 'DOWN' }));
    });

    it('lanza BadRequestException con el mensaje del driver si el equipo rechaza el comando', async () => {
      ifaceRepo.findOne.mockResolvedValue({ ...iface });
      driverRegistry.resolve.mockReturnValue({
        setInterfaceAdminState: jest.fn().mockResolvedValue({ ok: false, error: '% Unknown command' }),
      });

      await expect(service.setInterfaceAdminState('iface-1', 'DOWN')).rejects.toThrow(BadRequestException);
    });

    it('OLT VIA_MIKROTIK: usa el host/puerto resueltos por OltConnectionResolverService, no la IP privada cruda de la OLT (regresión del bug real en OLT-Azua_)', async () => {
      const viaMikrotikOlt = {
        id: 'olt-azua',
        vendor: 'HIOSO',
        host: '192.168.0.88', // IP privada de la OLT detrás del MikroTik -- NUNCA debe llegar al driver
        port: 23,
        connectionMethod: 'VIA_MIKROTIK',
        viaNodeId: 'node-azua-centro',
        natPort: 2324,
        username: 'admin',
        passwordEnc: 'enc',
      };
      ifaceRepo.findOne.mockResolvedValue({ id: 'iface-1', name: 'epon 1/1', adminState: 'UP', olt: viaMikrotikOlt });
      connectionResolver.resolve.mockResolvedValue({
        host: '172.16.100.5', // IP del MikroTik en el túnel WireGuard -- la correcta
        port: 2324, // nat_port de la OLT, no su puerto crudo (23)
        username: 'admin',
        password: 'decrypted-password',
      });
      const setInterfaceAdminState = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ setInterfaceAdminState });

      await service.setInterfaceAdminState('iface-1', 'DOWN');

      expect(connectionResolver.resolve).toHaveBeenCalledWith(viaMikrotikOlt);
      expect(setInterfaceAdminState).toHaveBeenCalledWith(
        expect.objectContaining({ host: '172.16.100.5', port: 2324 }),
        'epon 1/1',
        'DOWN',
      );
      const [calledParams] = setInterfaceAdminState.mock.calls[0];
      expect(calledParams.host).not.toBe('192.168.0.88');
      expect(calledParams.port).not.toBe(23);
    });
  });

  describe('syncSpeedProfileToOlt', () => {
    const olt = { id: 'olt-1', name: 'OLT Central ZTE', vendor: 'ZTE', host: '10.0.0.10', port: 23, username: 'admin', passwordEnc: 'enc' };
    const profile = { id: 'prof-1', name: 'Plan 5 Megas', vendorTcontProfile: 'FIXED5M', upKbps: 5000, downKbps: 5000 };

    it('lanza NotFoundException si la OLT no existe', async () => {
      oltRepo.findOneBy.mockResolvedValue(null);
      await expect(service.syncSpeedProfileToOlt('olt-x', 'prof-1')).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el perfil no existe', async () => {
      oltRepo.findOneBy.mockResolvedValue(olt);
      speedProfileRepo.findOneBy.mockResolvedValue(null);
      await expect(service.syncSpeedProfileToOlt('olt-1', 'prof-x')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el perfil no tiene vendorTcontProfile configurado', async () => {
      oltRepo.findOneBy.mockResolvedValue(olt);
      speedProfileRepo.findOneBy.mockResolvedValue({ ...profile, vendorTcontProfile: null });
      await expect(service.syncSpeedProfileToOlt('olt-1', 'prof-1')).rejects.toThrow(BadRequestException);
    });

    it('llama driver.ensureTcontProfile con el nombre y el ancho de banda de subida del perfil', async () => {
      oltRepo.findOneBy.mockResolvedValue(olt);
      speedProfileRepo.findOneBy.mockResolvedValue(profile);
      const ensureTcontProfile = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ ensureTcontProfile });

      const result = await service.syncSpeedProfileToOlt('olt-1', 'prof-1');

      expect(ensureTcontProfile).toHaveBeenCalledWith(
        { host: '10.0.0.10', port: 23, username: 'admin', password: expect.any(String) },
        { name: 'FIXED5M', fixedKbps: 5000 },
      );
      expect(result.success).toBe(true);
    });

    it('lanza BadRequestException con el mensaje del driver si la OLT rechaza el comando', async () => {
      oltRepo.findOneBy.mockResolvedValue(olt);
      speedProfileRepo.findOneBy.mockResolvedValue(profile);
      driverRegistry.resolve.mockReturnValue({
        ensureTcontProfile: jest.fn().mockResolvedValue({ ok: false, error: '% Unknown command' }),
      });

      await expect(service.syncSpeedProfileToOlt('olt-1', 'prof-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el vendor de la OLT no está registrado', async () => {
      oltRepo.findOneBy.mockResolvedValue(olt);
      speedProfileRepo.findOneBy.mockResolvedValue(profile);
      driverRegistry.resolve.mockImplementation(() => {
        throw new UnknownOltVendorError('RARO');
      });

      await expect(service.syncSpeedProfileToOlt('olt-1', 'prof-1')).rejects.toThrow(BadRequestException);
    });

    it('OLT VIA_MIKROTIK: usa el host/puerto resueltos por OltConnectionResolverService, no la IP privada cruda de la OLT', async () => {
      const viaMikrotikOlt = {
        id: 'olt-azua',
        name: 'OLT-Azua_',
        vendor: 'HIOSO',
        host: '192.168.0.88',
        port: 23,
        connectionMethod: 'VIA_MIKROTIK',
        viaNodeId: 'node-azua-centro',
        natPort: 2324,
        username: 'admin',
        passwordEnc: 'enc',
      };
      oltRepo.findOneBy.mockResolvedValue(viaMikrotikOlt);
      speedProfileRepo.findOneBy.mockResolvedValue(profile);
      connectionResolver.resolve.mockResolvedValue({
        host: '172.16.100.5',
        port: 2324,
        username: 'admin',
        password: 'decrypted-password',
      });
      const ensureTcontProfile = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ ensureTcontProfile });

      await service.syncSpeedProfileToOlt('olt-1', 'prof-1');

      expect(connectionResolver.resolve).toHaveBeenCalledWith(viaMikrotikOlt);
      expect(ensureTcontProfile).toHaveBeenCalledWith(
        expect.objectContaining({ host: '172.16.100.5', port: 2324 }),
        { name: 'FIXED5M', fixedKbps: 5000 },
      );
    });
  });

  describe('assignVlanToInterface', () => {
    const mockIface = {
      id: 'iface-1',
      name: 'ten-gigabitethernet 1/1',
      olt: {
        vendor: 'HIOSO',
        host: '10.0.0.10',
        port: 23,
        username: 'admin',
        passwordEnc: 'mock-enc',
      },
    };
    const mockVlan = { id: 'vlan-1', vlanId: 400, name: 'Internet' };

    it('asigna la VLAN a la interfaz sin aplicar en hardware (applyToHardware = false)', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue(mockVlan);
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);
      ifaceVlanRepo.create.mockImplementation((dto) => dto);
      ifaceVlanRepo.save.mockImplementation((entity) => Promise.resolve(entity));

      const res = await service.assignVlanToInterface('iface-1', 'vlan-1', 'TAG', false);

      expect(res.interfaceId).toBe('iface-1');
      expect(res.vlanId).toBe('vlan-1');
      expect(res.mode).toBe('TAG');
      expect(res.applyStatus).toBe('PENDING');
      expect(driverRegistry.resolve).not.toHaveBeenCalled();
    });

    it('aplica la VLAN en la OLT HiOSO mediante driver cuando applyToHardware = true', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue(mockVlan);
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);
      ifaceVlanRepo.create.mockImplementation((dto) => dto);
      ifaceVlanRepo.save.mockImplementation((entity) => Promise.resolve(entity));

      const configureVlanOnInterface = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ configureVlanOnInterface });

      const res = await service.assignVlanToInterface('iface-1', 'vlan-1', 'TAG', true);

      expect(configureVlanOnInterface).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.10', port: 23, username: 'admin' }),
        { interfaceName: 'ten-gigabitethernet 1/1', vlanId: 400, mode: 'TAG' },
      );
      expect(res.applyStatus).toBe('APPLIED');
    });

    it('marca ERROR y lanza BadRequestException si el comando en la OLT falla', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue(mockVlan);
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);
      ifaceVlanRepo.create.mockImplementation((dto) => dto);
      ifaceVlanRepo.save.mockImplementation((entity) => Promise.resolve(entity));

      const configureVlanOnInterface = jest.fn().mockResolvedValue({ ok: false, error: '% Vlan already exists' });
      driverRegistry.resolve.mockReturnValue({ configureVlanOnInterface });

      await expect(service.assignVlanToInterface('iface-1', 'vlan-1', 'TAG', true)).rejects.toThrow(
        BadRequestException,
      );
      expect(ifaceVlanRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ applyStatus: 'ERROR' }),
      );
    });

    it('OLT VIA_MIKROTIK: usa el host/puerto resueltos por OltConnectionResolverService, no la IP privada cruda de la OLT (regresión del 400 real contra epon 1/1 de OLT-Azua_)', async () => {
      const viaMikrotikIface = {
        id: 'iface-1',
        name: 'epon 1/1',
        olt: {
          id: 'olt-azua',
          vendor: 'HIOSO',
          host: '192.168.0.88',
          port: 23,
          connectionMethod: 'VIA_MIKROTIK',
          viaNodeId: 'node-azua-centro',
          natPort: 2324,
          username: 'admin',
          passwordEnc: 'enc',
        },
      };
      ifaceRepo.findOne.mockResolvedValue(viaMikrotikIface);
      vlanRepo.findOneBy.mockResolvedValue(mockVlan);
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);
      ifaceVlanRepo.create.mockImplementation((dto) => dto);
      ifaceVlanRepo.save.mockImplementation((entity) => Promise.resolve(entity));
      connectionResolver.resolve.mockResolvedValue({
        host: '172.16.100.5',
        port: 2324,
        username: 'admin',
        password: 'decrypted-password',
      });
      const configureVlanOnInterface = jest.fn().mockResolvedValue({ ok: true });
      driverRegistry.resolve.mockReturnValue({ configureVlanOnInterface });

      const res = await service.assignVlanToInterface('iface-1', 'vlan-1', 'TAG', true);

      expect(connectionResolver.resolve).toHaveBeenCalledWith(viaMikrotikIface.olt);
      expect(configureVlanOnInterface).toHaveBeenCalledWith(
        expect.objectContaining({ host: '172.16.100.5', port: 2324 }),
        { interfaceName: 'epon 1/1', vlanId: 400, mode: 'TAG' },
      );
      const [calledParams] = configureVlanOnInterface.mock.calls[0];
      expect(calledParams.host).not.toBe('192.168.0.88');
      expect(res.applyStatus).toBe('APPLIED');
    });
  });

  describe('scanRealInterfaceVlans (descubrimiento brownfield, confirmado en vivo contra OLT_Tabara_Abajo)', () => {
    const mockIface = {
      id: 'iface-1',
      name: 'gei_1/4/1',
      olt: { id: 'olt-1', vendor: 'ZTE', host: '10.0.0.10', port: 23, username: 'admin', passwordEnc: 'enc' },
    };

    it('distingue las VLANs ya rastreadas de las reales-pero-desconocidas', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      ifaceVlanRepo.find.mockResolvedValue([{ id: 'ifv-1', mode: 'TAG', vlan: { vlanId: 46 } }]);
      const getVlanConfigForInterface = jest.fn().mockResolvedValue([
        { vlanId: 46, mode: 'TAG' },
        { vlanId: 700, mode: 'TAG' },
      ]);
      driverRegistry.resolve.mockReturnValue({ getVlanConfigForInterface });

      const result = await service.scanRealInterfaceVlans('iface-1');

      expect(result).toEqual([
        { vlanId: 46, mode: 'TAG', alreadyTracked: true },
        { vlanId: 700, mode: 'TAG', alreadyTracked: false },
      ]);
      expect(getVlanConfigForInterface).toHaveBeenCalledWith(expect.anything(), 'gei_1/4/1');
    });

    it('lanza BadRequestException si el driver del fabricante no soporta descubrir VLANs reales', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      driverRegistry.resolve.mockReturnValue({}); // sin getVlanConfigForInterface

      await expect(service.scanRealInterfaceVlans('iface-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza NotFoundException si la interfaz no existe', async () => {
      ifaceRepo.findOne.mockResolvedValue(null);
      await expect(service.scanRealInterfaceVlans('iface-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('importDiscoveredInterfaceVlan', () => {
    const mockIface = {
      id: 'iface-1',
      name: 'gei_1/4/1',
      olt: { id: 'olt-1', name: 'OLT_Tabara_Abajo', vendor: 'ZTE' },
    };

    it('crea un catálogo VLAN placeholder si el número descubierto no existe todavía en net.vlans', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue(null);
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);

      const result = await service.importDiscoveredInterfaceVlan('iface-1', { vlanId: 700, mode: 'TAG' });

      expect(vlanRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ vlanId: 700, name: expect.stringContaining('VLAN 700'), type: 'INTERNET' }),
      );
      expect(result.applyStatus).toBe('APPLIED');
      expect(result.mode).toBe('TAG');
    });

    it('reutiliza el catálogo VLAN existente en vez de crear uno duplicado', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue({ id: 'vlan-1', vlanId: 46, name: 'TR-069' });
      ifaceVlanRepo.findOneBy.mockResolvedValue(null);

      await service.importDiscoveredInterfaceVlan('iface-1', { vlanId: 46, mode: 'TAG' });

      expect(vlanRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza con ConflictException si esa VLAN+modo ya estaba registrada para esta interfaz', async () => {
      ifaceRepo.findOne.mockResolvedValue(mockIface);
      vlanRepo.findOneBy.mockResolvedValue({ id: 'vlan-1', vlanId: 46, name: 'TR-069' });
      ifaceVlanRepo.findOneBy.mockResolvedValue({ id: 'ifv-existing' });

      await expect(
        service.importDiscoveredInterfaceVlan('iface-1', { vlanId: 46, mode: 'TAG' }),
      ).rejects.toThrow(/ya está registrada/);
    });

    it('lanza NotFoundException si la interfaz no existe', async () => {
      ifaceRepo.findOne.mockResolvedValue(null);
      await expect(
        service.importDiscoveredInterfaceVlan('iface-x', { vlanId: 46, mode: 'TAG' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

