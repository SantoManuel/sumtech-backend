import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OnuManagementService } from './onu-management.service';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { VlanEntity } from '../entities/vlan.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { NetworkNodeEntity } from '../../network/entities/network-node.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { ZteC320Driver } from '../drivers/zte-c320.driver';
import { ReachabilityResolver } from '../../network-connectivity/services/reachability-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';

describe('OnuManagementService', () => {
  let service: OnuManagementService;
  let onuRepo: any;
  let configRepo: any;
  let oltRepo: any;
  let ifaceRepo: any;
  let onuTypeRepo: any;
  let vlanRepo: any;
  let tr069Repo: any;
  let nodeRepo: any;
  let contractRepo: any;
  let zteDriver: any;
  let reachabilityResolver: any;
  let deviceOperationLogger: any;

  const mockOlt: Partial<OltEntity> = {
    id: 'olt-uuid-1',
    name: 'OLT Central ZTE C320',
    model: 'ZTE-C320',
    host: '10.0.0.10',
    port: 23,
    username: 'admin',
    passwordEnc: 'enc-pass',
  };

  const mockOnu: Partial<OnuEntity> = {
    id: 'onu-uuid-1',
    oltId: 'olt-uuid-1',
    onuIndex: 'gpon-onu_1/1/1:1',
    serialNumber: 'ZTEGC0123456',
    vendor: 'ZTE',
    status: 'UNCONFIGURED',
    olt: mockOlt as OltEntity,
    ponInterface: { id: 'iface-1', name: 'gpon-olt_1/1/1' } as any,
  };

  beforeEach(async () => {
    onuRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || 'saved-onu-id' })),
      create: jest.fn((dto) => ({ ...dto })),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockOnu]),
      })),
    };

    configRepo = {
      findOneBy: jest.fn(),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: 'config-1' })),
      create: jest.fn((dto) => ({ ...dto })),
    };

    oltRepo = {
      findOneBy: jest.fn().mockResolvedValue(mockOlt),
    };

    ifaceRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'iface-1', name: 'gpon-olt_1/1/1' }),
    };

    onuTypeRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'type-1', modelName: 'ZTE-F660' }),
    };

    vlanRepo = {
      findOneBy: jest.fn().mockResolvedValue({ id: 'vlan-1', vlanId: 200, name: 'Clientes-GPON' }),
    };

    const mockTr069Data = {
      id: 'tr069-1',
      vlanId: 46,
      acsUrl: 'http://10.46.0.1:7547/',
      subnet: '10.46.0.0/24',
      gateway: '10.46.0.1',
      vlan: { vlanId: 46 },
    };

    tr069Repo = {
      findOneBy: jest.fn().mockResolvedValue(mockTr069Data),
      findOne: jest.fn().mockResolvedValue(mockTr069Data),
    };

    nodeRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };

    contractRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CLI-00123',
        client: { firstName: 'Maria', lastName: 'Perez' },
      }),
    };

    zteDriver = {
      getUnconfiguredOnus: jest.fn(),
      getOnuOpticalPower: jest.fn(),
      generateAuthorizationScript: jest.fn(),
      authorizeOnu: jest.fn(),
      setOnuAdminState: jest.fn(),
      deleteOnu: jest.fn(),
    };

    reachabilityResolver = {
      resolveReachability: jest.fn().mockResolvedValue({
        directIp: '10.0.0.10',
        port: 23,
      }),
    };

    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuManagementService,
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: getRepositoryToken(OnuServiceConfigEntity), useValue: configRepo },
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: ifaceRepo },
        { provide: getRepositoryToken(OnuTypeEntity), useValue: onuTypeRepo },
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: getRepositoryToken(Tr069NetworkEntity), useValue: tr069Repo },
        { provide: getRepositoryToken(NetworkNodeEntity), useValue: nodeRepo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: ZteC320Driver, useValue: zteDriver },
        { provide: ReachabilityResolver, useValue: reachabilityResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
      ],
    }).compile();

    service = module.get<OnuManagementService>(OnuManagementService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findUnconfigured', () => {
    it('retorna las ONUs con status UNCONFIGURED', async () => {
      onuRepo.find.mockResolvedValue([mockOnu]);

      const result = await service.findUnconfigured('olt-uuid-1');

      expect(result).toHaveLength(1);
      expect(onuRepo.find).toHaveBeenCalledWith({
        where: { status: 'UNCONFIGURED', oltId: 'olt-uuid-1' },
        relations: ['olt', 'ponInterface'],
        order: { detectedAt: 'DESC' },
      });
    });
  });

  describe('scanUnconfiguredOnus', () => {
    it('escanea la OLT y persiste las ONUs no configuradas encontradas', async () => {
      zteDriver.getUnconfiguredOnus.mockResolvedValue([
        {
          onuIndex: 'gpon-onu_1/1/1:1',
          serialNumber: 'ZTEGC0123456',
          vendor: 'ZTE',
          ponInterface: 'gpon-olt_1/1/1',
        },
      ]);
      onuRepo.findOneBy.mockResolvedValue(null); // No existía

      const result = await service.scanUnconfiguredOnus('olt-uuid-1', 'admin-id');

      expect(result).toHaveLength(1);
      expect(zteDriver.getUnconfiguredOnus).toHaveBeenCalled();
      expect(onuRepo.save).toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'COMMAND',
          status: 'SUCCESS',
        }),
      );
    });

    it('lanza NotFoundException si la OLT no existe', async () => {
      oltRepo.findOneBy.mockResolvedValue(null);

      await expect(service.scanUnconfiguredOnus('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getOpticalTelemetry', () => {
    it('obtiene la telemetría óptica de potencia y actualiza la ONU', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuOpticalPower.mockResolvedValue({
        upRxDbm: -21.45,
        txDbm: 2.15,
        downRxDbm: -19.80,
        rxDbm: -19.80,
        attenuationDb: 23.60,
      });

      const telemetry = await service.getOpticalTelemetry('onu-uuid-1');

      expect(telemetry.rxPowerDbm).toBe(-19.80);
      expect(telemetry.txPowerDbm).toBe(2.15);
      expect(telemetry.signalStatus).toBe('OPTIMAL');
      expect(onuRepo.save).toHaveBeenCalled();
    });

    it('clasifica potencia menor a -27 dBm como CRITICAL_LOW', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuOpticalPower.mockResolvedValue({
        upRxDbm: -30.0,
        txDbm: 1.0,
        downRxDbm: -28.5,
        rxDbm: -28.5,
        attenuationDb: 29.5,
      });

      const telemetry = await service.getOpticalTelemetry('onu-uuid-1');

      expect(telemetry.signalStatus).toBe('CRITICAL_LOW');
    });
  });

  describe('previewAuthorizationScript', () => {
    it('genera comandos CLI de aprovisionamiento en modo dry-run', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.generateAuthorizationScript.mockReturnValue([
        'configure terminal',
        'interface gpon-olt_1/1/1',
        'onu 1 type ZTE-F660 sn ZTEGC0123456',
      ]);

      const preview = await service.previewAuthorizationScript('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        onuTypeId: 'type-1',
        contractId: 'contract-1',
      });

      expect(preview.commands).toHaveLength(3);
      expect(preview.totalCommands).toBe(3);
      expect(zteDriver.generateAuthorizationScript).toHaveBeenCalled();
    });
  });

  describe('authorizeOnu', () => {
    it('provisiona la ONU en la OLT, guarda service_config y cambia estado a ACTIVE', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      const dto = {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        onuTypeId: 'type-1',
        contractId: 'contract-1',
        managementMethod: 'TR069',
        operationMode: 'ROUTER',
        wanMode: 'PPPOE',
      };

      const result = await service.authorizeOnu('onu-uuid-1', dto, 'admin-id');

      expect(zteDriver.authorizeOnu).toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalled();
      expect(onuRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ACTIVE',
        }),
      );
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'PROVISION',
          status: 'SUCCESS',
        }),
      );
    });

    it('lanza BadRequestException si el driver de la OLT falla aprovisionando', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.authorizeOnu.mockResolvedValue({ ok: false, error: 'ONU index already in use' });

      await expect(
        service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1' }, 'admin-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('blockOnu & unblockOnu', () => {
    it('bloquea la ONU en la OLT y cambia su estado a BLOCKED', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      zteDriver.setOnuAdminState.mockResolvedValue({ ok: true });

      const res = await service.blockOnu('onu-uuid-1', 'admin-id');

      expect(res.status).toBe('BLOCKED');
      expect(zteDriver.setOnuAdminState).toHaveBeenCalledWith(
        expect.anything(),
        'gpon-onu_1/1/1:1',
        'BLOCKED',
      );
    });

    it('desbloquea la ONU en la OLT y reactiva su estado a ACTIVE', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'BLOCKED' });
      zteDriver.setOnuAdminState.mockResolvedValue({ ok: true });

      const res = await service.unblockOnu('onu-uuid-1', 'admin-id');

      expect(res.status).toBe('ACTIVE');
      expect(zteDriver.setOnuAdminState).toHaveBeenCalledWith(
        expect.anything(),
        'gpon-onu_1/1/1:1',
        'ACTIVE',
      );
    });
  });
});
