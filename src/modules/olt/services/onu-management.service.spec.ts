import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { OnuManagementService } from './onu-management.service';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { OltEntity } from '../entities/olt.entity';
import { OltInterfaceEntity } from '../entities/olt-interface.entity';
import { OnuTypeEntity } from '../entities/onu-type.entity';
import { OltSpeedProfileEntity } from '../entities/olt-speed-profile.entity';
import { VlanEntity } from '../entities/vlan.entity';
import { Tr069NetworkEntity } from '../entities/tr069-network.entity';
import { NetworkAccessEntity } from '../../network/entities/network-access.entity';
import { NapPortEntity } from '../../network/entities/nap-port.entity';
import { ContractEntity } from '../../clients/entities/contract.entity';
import { OltDriverRegistry } from '../drivers/olt-driver.registry';
import { OltConnectionResolverService } from './olt-connection-resolver.service';
import { DeviceOperationLogger } from '../../network-connectivity/services/device-operation-logger.service';
import { CpeConfiguratorService } from '../../genieacs/services/cpe-configurator.service';
import { TenantContextService } from '../../../common/tenancy/tenant-context.service';
import { UnknownOltVendorError, DriverNotImplementedError } from '../ports/olt-driver.port';
import { encryptCredential } from '../../network-connectivity/utils/crypto.util';
import { OnuOpticalHistoryEntity } from '../entities/onu-optical-history.entity';

describe('OnuManagementService', () => {
  let service: OnuManagementService;
  let onuRepo: any;
  let configRepo: any;
  let opticalHistoryRepo: any;
  let oltRepo: any;
  let ifaceRepo: any;
  let onuTypeRepo: any;
  let speedProfileRepo: any;
  let vlanRepo: any;
  let tr069Repo: any;
  let contractRepo: any;
  let networkAccessRepo: any;
  let napPortRepo: any;
  let zteDriver: any;
  let driverRegistry: any;
  let connectionResolver: any;
  let deviceOperationLogger: any;
  let cpeConfiguratorService: any;
  let tenantContext: any;
  let onuQueryBuilder: any;

  const mockOlt: Partial<OltEntity> = {
    id: 'olt-uuid-1',
    name: 'OLT Central ZTE C320',
    vendor: 'ZTE',
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((dto) => ({ ...dto })),
      findAndCount: jest.fn().mockResolvedValue([[mockOnu], 1]),
      createQueryBuilder: jest.fn(),
    };
    onuQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([mockOnu]),
      getManyAndCount: jest.fn().mockResolvedValue([[mockOnu], 1]),
    };
    onuRepo.createQueryBuilder.mockReturnValue(onuQueryBuilder);

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
      findOneBy: jest.fn().mockResolvedValue({ id: 'type-1', model: 'F660', vendorTypeName: 'ZTE-F660' }),
    };

    speedProfileRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'profile-1',
        code: 'OLT-100M',
        downKbps: 102400,
        upKbps: 102400,
        vendorTcontProfile: 'TCONT-100M',
      }),
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

    contractRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CLI-00123',
        client: { firstName: 'Maria', lastName: 'Perez' },
      }),
      findOneBy: jest.fn().mockResolvedValue({
        id: 'contract-1',
        contractNumber: 'CLI-00123',
        client: { firstName: 'Maria', lastName: 'Perez' },
      }),
    };

    networkAccessRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
    };

    napPortRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'nap-port-1', portNumber: 1, status: 'DISPONIBLE', onuId: null }),
      save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    opticalHistoryRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn().mockResolvedValue({}),
      find: jest.fn().mockResolvedValue([]),
    };

    zteDriver = {
      getUnconfiguredOnus: jest.fn(),
      getAuthorizedOnus: jest.fn(),
      getOnuOpticalPower: jest.fn(),
      generateAuthorizationScript: jest.fn(),
      authorizeOnu: jest.fn(),
      setOnuAdminState: jest.fn(),
      deleteOnu: jest.fn(),
      constructor: { name: 'ZteC320Driver' },
    };

    driverRegistry = {
      resolve: jest.fn().mockReturnValue(zteDriver),
      attachCapabilities: jest.fn((entity) => Object.assign(entity, { capabilities: { onuDelete: true } })),
    };

    connectionResolver = {
      resolve: jest.fn().mockResolvedValue({
        host: '10.0.0.10',
        port: 23,
        username: 'admin',
        password: 'decrypted-admin-pass',
      }),
    };

    deviceOperationLogger = {
      logEvent: jest.fn().mockResolvedValue(undefined),
    };

    cpeConfiguratorService = {
      configureCpe: jest.fn().mockResolvedValue({ success: true, deviceId: 'dev-1', appliedParametersCount: 3, verification: {}, message: 'ok' }),
    };

    tenantContext = {
      getSlug: jest.fn().mockReturnValue('sumtech'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuManagementService,
        { provide: getRepositoryToken(OnuEntity), useValue: onuRepo },
        { provide: getRepositoryToken(OnuServiceConfigEntity), useValue: configRepo },
        { provide: getRepositoryToken(OnuOpticalHistoryEntity), useValue: opticalHistoryRepo },
        { provide: getRepositoryToken(OltEntity), useValue: oltRepo },
        { provide: getRepositoryToken(OltInterfaceEntity), useValue: ifaceRepo },
        { provide: getRepositoryToken(OnuTypeEntity), useValue: onuTypeRepo },
        { provide: getRepositoryToken(OltSpeedProfileEntity), useValue: speedProfileRepo },
        { provide: getRepositoryToken(VlanEntity), useValue: vlanRepo },
        { provide: getRepositoryToken(Tr069NetworkEntity), useValue: tr069Repo },
        { provide: getRepositoryToken(ContractEntity), useValue: contractRepo },
        { provide: getRepositoryToken(NetworkAccessEntity), useValue: networkAccessRepo },
        { provide: getRepositoryToken(NapPortEntity), useValue: napPortRepo },
        { provide: OltDriverRegistry, useValue: driverRegistry },
        { provide: OltConnectionResolverService, useValue: connectionResolver },
        { provide: DeviceOperationLogger, useValue: deviceOperationLogger },
        { provide: CpeConfiguratorService, useValue: cpeConfiguratorService },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get<OnuManagementService>(OnuManagementService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('devuelve {data,total,page,limit,totalPages} con la entidad cruda (serialNumber/mac/onuIndex/ponInterface/onuType/rxPowerDbm/contract) sin mapear -- la tabla "ONUs / Fibra" de red/page.tsx y el selector de ConfigureNetworkAccessModal leen estos mismos nombres', async () => {
      const result = await service.findAll();

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(result.data).toEqual([mockOnu]);
      // Campos puntuales que ambas vistas consumidoras leen directo de la
      // entidad -- una "forma limpia" que los renombre rompe alguna de las
      // dos en silencio (ya pasó una vez, ver commit de este archivo).
      expect(result.data[0].serialNumber).toBe('ZTEGC0123456');
      expect(result.data[0].onuIndex).toBe('gpon-onu_1/1/1:1');
      expect(result.data[0].ponInterface).toEqual({ id: 'iface-1', name: 'gpon-olt_1/1/1' });
    });

    it('aplica page/limit explícitos con skip/take', async () => {
      await service.findAll({ page: 3, limit: 10 } as any);

      expect(onuQueryBuilder.skip).toHaveBeenCalledWith(20);
      expect(onuQueryBuilder.take).toHaveBeenCalledWith(10);
    });

    it('con un único status, filtra con igualdad', async () => {
      await service.findAll({ status: 'ACTIVE' } as any);

      expect(onuQueryBuilder.andWhere).toHaveBeenCalledWith('onu.status = :status', { status: 'ACTIVE' });
    });

    it('con status separado por comas, filtra con IN (usado por "ONUs Aprovisionadas" para excluir UNCONFIGURED)', async () => {
      await service.findAll({ status: 'AUTHORIZING,ACTIVE,BLOCKED,OFFLINE,LOS,ERROR' } as any);

      expect(onuQueryBuilder.andWhere).toHaveBeenCalledWith('onu.status IN (:...statuses)', {
        statuses: ['AUTHORIZING', 'ACTIVE', 'BLOCKED', 'OFFLINE', 'LOS', 'ERROR'],
      });
    });
  });

  describe('findUnconfigured', () => {
    it('retorna las ONUs con status UNCONFIGURED paginadas', async () => {
      onuRepo.findAndCount.mockResolvedValue([[mockOnu], 1]);

      const result = await service.findUnconfigured({ oltId: 'olt-uuid-1' } as any);

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.totalPages).toBe(1);
      expect(onuRepo.findAndCount).toHaveBeenCalledWith({
        where: { status: 'UNCONFIGURED', oltId: 'olt-uuid-1' },
        relations: ['olt', 'olt.zone', 'ponInterface'],
        order: { detectedAt: 'DESC' },
        skip: 0,
        take: 20,
      });
    });

    it('aplica page/limit explícitos', async () => {
      onuRepo.findAndCount.mockResolvedValue([[], 45]);

      const result = await service.findUnconfigured({ page: 2, limit: 20 } as any);

      expect(onuRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 20 }),
      );
      expect(result.totalPages).toBe(3);
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

    it('para una ONU ya existente, usa update() dirigido en vez de save() completo -- nunca debe reescribir status (bug real 2026-10-17: un save() completo pisaba en silencio una autorización concurrente)', async () => {
      zteDriver.getUnconfiguredOnus.mockResolvedValue([
        {
          onuIndex: 'gpon-onu_1/1/1:1',
          serialNumber: 'ZTEGC0123456',
          vendor: 'ZTE',
          ponInterface: 'gpon-olt_1/1/1',
        },
      ]);
      // Esta ONU ya existe y ya fue autorizada (status ACTIVE) -- el escaneo
      // solo debe actualizar onuIndex/ponInterfaceId/lastSeenAt, nunca tocar status.
      const existingActiveOnu = { ...mockOnu, id: 'onu-uuid-1', status: 'ACTIVE', contractId: 'contract-1' };
      onuRepo.findOneBy.mockResolvedValue(existingActiveOnu);

      const result = await service.scanUnconfiguredOnus('olt-uuid-1', 'admin-id');

      expect(onuRepo.update).toHaveBeenCalledWith(
        'onu-uuid-1',
        expect.objectContaining({ onuIndex: 'gpon-onu_1/1/1:1', ponInterfaceId: 'iface-1' }),
      );
      // El objeto pasado a update() nunca debe incluir 'status' -- si algún
      // día alguien vuelve a meter un save(entidadCompleta), este assert no
      // lo detectaría, pero si se agrega 'status' al payload de update() a
      // propósito, debe hacerse explícito y revisado, no colado sin querer.
      const updatePayload = onuRepo.update.mock.calls[0][1];
      expect(updatePayload).not.toHaveProperty('status');
      expect(onuRepo.save).not.toHaveBeenCalled();
      expect(result[0].status).toBe('ACTIVE');
    });
  });

  describe('scanAuthorizedOnus', () => {
    it('importa como ACTIVE una ONU ya autorizada por otro sistema, sin llamar a authorizeOnu()', async () => {
      zteDriver.getAuthorizedOnus.mockResolvedValue([
        {
          ponInterface: 'gpon-olt_1/2/1',
          onuIndex: 'gpon-onu_1/2/1:2',
          serialNumber: 'HWTC9A427958',
          vendor: 'Huawei',
          onuType: 'EG8141A5',
          adminState: 'ENABLE',
          phaseState: 'working',
        },
      ]);
      onuRepo.findOneBy.mockResolvedValue(null); // no existía en nuestra base

      const result = await service.scanAuthorizedOnus('olt-uuid-1', 'gpon-olt_1/2/1', 'admin-id');

      expect(result).toHaveLength(1);
      expect(zteDriver.getAuthorizedOnus).toHaveBeenCalledWith(expect.anything(), 'gpon-olt_1/2/1');
      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
      expect(onuRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          serialNumber: 'HWTC9A427958',
          status: 'ACTIVE',
          detectedBy: 'OLT_IMPORT',
        }),
      );
      // Importada sin contrato -- vincular al cliente real es un paso manual
      expect(onuRepo.create).toHaveBeenCalledWith(expect.not.objectContaining({ contractId: expect.anything() }));
    });

    it('importa como BLOCKED una ONU que la OLT reporta deshabilitada', async () => {
      zteDriver.getAuthorizedOnus.mockResolvedValue([
        {
          ponInterface: 'gpon-olt_1/2/1',
          onuIndex: 'gpon-onu_1/2/1:3',
          serialNumber: 'RMTGCB52DE3A',
          vendor: 'Desconocido',
          adminState: 'DISABLE',
          phaseState: 'OffLine',
        },
      ]);
      onuRepo.findOneBy.mockResolvedValue(null);

      await service.scanAuthorizedOnus('olt-uuid-1', 'gpon-olt_1/2/1', 'admin-id');

      expect(onuRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'BLOCKED' }));
    });

    it('nunca toca una ONU que ya existe en nuestra base (por serial)', async () => {
      zteDriver.getAuthorizedOnus.mockResolvedValue([
        {
          ponInterface: 'gpon-olt_1/2/1',
          onuIndex: 'gpon-onu_1/2/1:1',
          serialNumber: 'ZTEGC0123456',
          vendor: 'ZTE',
          adminState: 'ENABLE',
          phaseState: 'working',
        },
      ]);
      onuRepo.findOneBy.mockResolvedValue(mockOnu); // ya existe

      const result = await service.scanAuthorizedOnus('olt-uuid-1', 'gpon-olt_1/2/1', 'admin-id');

      expect(result).toHaveLength(0);
      expect(onuRepo.create).not.toHaveBeenCalled();
      expect(onuRepo.save).not.toHaveBeenCalled();
    });

    it('lanza 501 DRIVER_NOT_IMPLEMENTED si el fabricante no tiene getAuthorizedOnus (ej. HiOSO)', async () => {
      const driverSinSoporte: any = { constructor: { name: 'HiosoDriver' } }; // sin getAuthorizedOnus
      driverRegistry.resolve.mockReturnValue(driverSinSoporte);

      await expect(
        service.scanAuthorizedOnus('olt-uuid-1', 'gpon-olt_1/2/1', 'admin-id'),
      ).rejects.toThrow(HttpException);
    });

    it('lanza NotFoundException si la OLT no existe', async () => {
      oltRepo.findOneBy.mockResolvedValue(null);

      await expect(service.scanAuthorizedOnus('inexistente', 'gpon-olt_1/2/1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('linkOnuToContract', () => {
    it('vincula una ONU ACTIVE sin contrato, sin tocar la OLT', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: null, olt: mockOlt });

      const result = await service.linkOnuToContract('onu-uuid-1', 'contract-1', 'admin-id');

      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', { contractId: 'contract-1' });
      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ rawDetails: expect.objectContaining({ operation: 'linkOnuToContract' }) }),
      );
      expect(result).toBeDefined();
    });

    it('rechaza vincular una ONU que no esté ACTIVE', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED', contractId: null, olt: mockOlt });

      await expect(service.linkOnuToContract('onu-uuid-1', 'contract-1')).rejects.toThrow(BadRequestException);
      expect(onuRepo.update).not.toHaveBeenCalled();
    });

    it('rechaza vincular una ONU que ya tiene contrato (evita pisar un vínculo existente)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: 'contract-ya-vinculado', olt: mockOlt });

      await expect(service.linkOnuToContract('onu-uuid-1', 'contract-1')).rejects.toThrow(BadRequestException);
      expect(onuRepo.update).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el contrato no existe', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: null, olt: mockOlt });
      contractRepo.findOneBy.mockResolvedValue(null);

      await expect(service.linkOnuToContract('onu-uuid-1', 'contrato-inexistente')).rejects.toThrow(NotFoundException);
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
      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', expect.objectContaining({ rxPowerDbm: -19.80, txPowerDbm: 2.15 }));
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
      expect(onuRepo.update).toHaveBeenCalledWith(
        'onu-uuid-1',
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

    it('normaliza tr069NetworkId/mgmtVlanId/tr069VlanId/speedProfileId "" a undefined antes de guardar onu_service_config (regresión: Postgres rechaza "" como uuid)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        managementMethod: 'TR069',
        operationMode: 'ROUTER',
        tr069NetworkId: '',
        mgmtVlanId: '',
        tr069VlanId: '',
        speedProfileId: '',
      });

      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tr069NetworkId: undefined,
          mgmtVlanId: undefined,
          tr069VlanId: undefined,
          speedProfileId: undefined,
        }),
      );
    });

    it('resuelve speedProfileId a tcontProfile/downKbps/upKbps y los pasa al driver (antes de este fix nunca se leía)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        speedProfileId: 'profile-1',
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      });

      expect(speedProfileRepo.findOneBy).toHaveBeenCalledWith({ id: 'profile-1' });
      expect(zteDriver.authorizeOnu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tcontProfile: 'TCONT-100M',
          downKbps: 102400,
          upKbps: 102400,
        }),
      );
    });

    it('pasa clientName/description tal cual al driver -- el backend no los recalcula, confía en lo que resolvió el frontend (ver docs/onu-tr069-provisioning-zte-c320.md)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
        clientName: 'Juan_Perez',
        description: 'zone_Tabara_Abajo_lat_18.65_long_-71.03_authd_20261020',
      });

      expect(zteDriver.authorizeOnu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          clientName: 'Juan_Perez',
          description: 'zone_Tabara_Abajo_lat_18.65_long_-71.03_authd_20261020',
        }),
      );
    });

    it('resuelve también vendorTrafficProfile a trafficProfile si el perfil lo tiene configurado', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      speedProfileRepo.findOneBy.mockResolvedValueOnce({
        id: 'profile-1',
        code: 'OLT-100M',
        downKbps: 102400,
        upKbps: 102400,
        vendorTcontProfile: 'TCONT-100M',
        vendorTrafficProfile: 'TRAFFIC-100M',
      });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        speedProfileId: 'profile-1',
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      });

      expect(zteDriver.authorizeOnu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          trafficProfile: 'TRAFFIC-100M',
          downKbps: 102400,
        }),
      );
    });

    it('con managementMethod TR069 y tr069NetworkId, llama a CpeConfiguratorService.configureCpe() y marca cpeConfigured:true', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      const result = await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        tr069NetworkId: 'tr069-1',
        managementMethod: 'TR069',
        operationMode: 'BRIDGE',
        wanMode: 'DHCP',
      });

      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          serialNumber: mockOnu.serialNumber,
          operationMode: 'BRIDGE',
          wanMode: 'DHCP',
          tenantSlug: 'sumtech',
          managementServer: expect.objectContaining({ acsUrl: 'http://10.46.0.1:7547/' }),
        }),
      );
      expect((result as any).cpeConfigured).toBe(true);
      expect((result as any).cpeConfigWarning).toBeUndefined();
      // Persistido en onu_service_config -- OnuCpeSyncReconciliationService
      // usa esto (no "apply_status", que es del lado OLT) para saber que ya
      // no hace falta reintentar.
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cpeConfigStatus: 'APPLIED', cpeConfigSyncedAt: expect.any(Date) }),
      );
    });

    it('con wanMode PPPOE y contractId, resuelve usuario/contraseña desde el network_access ya vinculado (fuente única de verdad)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      networkAccessRepo.findOneBy.mockResolvedValue({
        contractId: 'contract-1',
        username: 'cliente123',
        pppoePasswordEnc: encryptCredential('ClavePppoeReal!'),
      });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        contractId: 'contract-1',
        managementMethod: 'TR069',
        wanMode: 'PPPOE',
      });

      expect(networkAccessRepo.findOneBy).toHaveBeenCalledWith({ contractId: 'contract-1' });
      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          wanMode: 'PPPOE',
          pppoeUsername: 'cliente123',
          pppoePassword: 'ClavePppoeReal!',
        }),
      );
    });

    it('con wanMode PPPOE pero sin network_access para ese contrato, no rompe y manda las credenciales undefined', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      networkAccessRepo.findOneBy.mockResolvedValue(null);

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        contractId: 'contract-1',
        managementMethod: 'TR069',
        wanMode: 'PPPOE',
      });

      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          pppoeUsername: undefined,
          pppoePassword: undefined,
        }),
      );
    });

    it('con wanMode STATIC, pasa wanStaticIp/Mask/Gw tal cual al configurador CPE', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        managementMethod: 'TR069',
        wanMode: 'STATIC',
        wanStaticIp: '200.1.1.50',
        wanStaticMask: '255.255.255.0',
        wanStaticGw: '200.1.1.1',
      });

      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          wanMode: 'STATIC',
          wanStaticIp: '200.1.1.50',
          wanStaticMask: '255.255.255.0',
          wanStaticGw: '200.1.1.1',
        }),
      );
      expect(networkAccessRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('con wanMode DHCP, no consulta network_access ni manda campos de estática', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        contractId: 'contract-1',
        managementMethod: 'TR069',
        wanMode: 'DHCP',
      });

      expect(networkAccessRepo.findOneBy).not.toHaveBeenCalled();
      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          wanMode: 'DHCP',
          wanStaticIp: undefined,
          wanStaticMask: undefined,
          wanStaticGw: undefined,
        }),
      );
    });

    it('si GenieACS todavía no conoce el ONU, no falla la autorización completa — agrega cpeConfigWarning', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      cpeConfiguratorService.configureCpe.mockRejectedValue(
        new NotFoundException('El CPE con serial "ZTEGC0123456" no ha sido detectado por GenieACS (aún no ha enviado Inform).'),
      );

      const result = await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        managementMethod: 'TR069',
      });

      expect((result as any).cpeConfigured).toBe(false);
      expect((result as any).cpeConfigWarning).toContain('ONU autorizada en la OLT');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', expect.objectContaining({ status: 'ACTIVE' }));
      // Persistido para que OnuCpeSyncReconciliationService la reintente sola.
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ cpeConfigStatus: 'ERROR', lastCpeConfigError: expect.stringContaining('GenieACS') }),
      );
    });

    it('con managementMethod OMCI, nunca llama a CpeConfiguratorService', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      const result = await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        tr069NetworkId: 'tr069-1',
        managementMethod: 'OMCI',
      });

      expect(cpeConfiguratorService.configureCpe).not.toHaveBeenCalled();
      expect((result as any).cpeConfigured).toBeUndefined();
    });

    it('lanza BadRequestException si el driver de la OLT falla aprovisionando', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.authorizeOnu.mockResolvedValue({ ok: false, error: 'ONU index already in use' });

      await expect(
        service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1' }, 'admin-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('reprovisionOnu', () => {
    const mockConfig = {
      onuId: 'onu-uuid-1',
      serviceVlanId: 'vlan-1',
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
      wanMode: 'PPPOE',
      appliedVersion: 1,
      desiredVersion: 1,
    };

    it('rechaza reconfigurar una ONU que no esté ACTIVE', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });

      await expect(service.reprovisionOnu('onu-uuid-1', {}, 'admin-id')).rejects.toThrow(
        BadRequestException,
      );
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza reconfigurar una ONU ACTIVE que nunca tuvo onu_service_config', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      configRepo.findOneBy.mockResolvedValue(null);

      await expect(service.reprovisionOnu('onu-uuid-1', {}, 'admin-id')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('actualiza onu_service_config SIN llamar al driver.authorizeOnu (no re-dispara el CLI de la OLT)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: 'contract-1', onuTypeId: 'type-1' });
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      await service.reprovisionOnu('onu-uuid-1', {
        managementMethod: 'TR069',
        tr069NetworkId: 'tr069-1',
        operationMode: 'BRIDGE',
      }, 'admin-id');

      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          managementMethod: 'TR069',
          tr069NetworkId: 'tr069-1',
          operationMode: 'BRIDGE',
          appliedVersion: 2,
          desiredVersion: 2,
        }),
      );
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROVISION', status: 'SUCCESS', rawDetails: expect.objectContaining({ operation: 'reprovisionOnu' }) }),
      );
    });

    it('con managementMethod TR069, reintenta el push a GenieACS y marca cpeConfigured:true', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: 'contract-1', onuTypeId: 'type-1' });
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      const result = await service.reprovisionOnu('onu-uuid-1', {
        managementMethod: 'TR069',
        tr069NetworkId: 'tr069-1',
      }, 'admin-id');

      expect(cpeConfiguratorService.configureCpe).toHaveBeenCalledWith(
        expect.objectContaining({
          serialNumber: mockOnu.serialNumber,
          managementServer: expect.objectContaining({ acsUrl: 'http://10.46.0.1:7547/' }),
        }),
      );
      expect((result as any).cpeConfigured).toBe(true);
    });

    it('si el push a GenieACS falla, no revierte la configuración guardada y marca cpeConfigured:false con advertencia', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: 'contract-1', onuTypeId: 'type-1' });
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      cpeConfiguratorService.configureCpe.mockRejectedValue(new Error('CPE no respondió al primer Inform'));

      const result = await service.reprovisionOnu('onu-uuid-1', {
        managementMethod: 'TR069',
        tr069NetworkId: 'tr069-1',
      }, 'admin-id');

      expect(configRepo.save).toHaveBeenCalled();
      expect((result as any).cpeConfigured).toBe(false);
      expect((result as any).cpeConfigWarning).toContain('GenieACS');
    });

    it('con managementMethod OMCI, no llama a GenieACS', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      const result = await service.reprovisionOnu('onu-uuid-1', { managementMethod: 'OMCI' }, 'admin-id');

      expect(cpeConfiguratorService.configureCpe).not.toHaveBeenCalled();
      expect((result as any).cpeConfigured).toBeUndefined();
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

    it('nunca ejecuta setOnuAdminState del driver si el vendor de la OLT no es reconocido (ciclo de cobranza OLT_NATIVE)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      driverRegistry.resolve.mockImplementation(() => {
        throw new UnknownOltVendorError('MARCA-DESCONOCIDA');
      });

      await expect(service.blockOnu('onu-uuid-1', 'admin-id')).rejects.toThrow(BadRequestException);
      expect(zteDriver.setOnuAdminState).not.toHaveBeenCalled();
    });

    it('cuando onuIndex es un número suelto (caso normal tras descubrir una ONU), arma la sub-interfaz como "gpon-onu_X/Y/Z:N" -- NO "gpon-olt_X/Y/Z:N" (bug real confirmado en vivo contra OLT_Tabara_Abajo, 2026-10-20: la OLT distingue el puerto físico de la sub-interfaz lógica de la ONU)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', onuIndex: '1' });
      zteDriver.setOnuAdminState.mockResolvedValue({ ok: true });

      await service.blockOnu('onu-uuid-1', 'admin-id');

      expect(zteDriver.setOnuAdminState).toHaveBeenCalledWith(
        expect.anything(),
        'gpon-onu_1/1/1:1',
        'BLOCKED',
      );
    });
  });

  describe('findById', () => {
    it('adjunta las capacidades reales del fabricante a onu.olt', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, olt: { ...mockOlt } });

      const result = await service.findById('onu-uuid-1');

      expect(driverRegistry.attachCapabilities).toHaveBeenCalledWith(result.olt);
      expect((result.olt as any).capabilities).toEqual({ onuDelete: true });
    });

    it('lanza NotFoundException si la ONU no existe', async () => {
      onuRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('inexistente')).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOnu', () => {
    it('elimina la ONU en la OLT y borra el registro local', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      onuRepo.delete = jest.fn().mockResolvedValue({ affected: 1 });
      zteDriver.deleteOnu.mockResolvedValue({ ok: true });

      const result = await service.deleteOnu('onu-uuid-1', 'admin-id');

      expect(result.success).toBe(true);
      expect(zteDriver.deleteOnu).toHaveBeenCalledWith(expect.anything(), 'gpon-olt_1/1/1', 1);
      expect(onuRepo.delete).toHaveBeenCalledWith({ id: 'onu-uuid-1' });
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'COMMAND', status: 'SUCCESS' }),
      );
    });

    it('lanza BadRequestException y no borra el registro si el driver falla', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      onuRepo.delete = jest.fn();
      zteDriver.deleteOnu.mockResolvedValue({ ok: false, error: 'Timeout de Telnet' });

      await expect(service.deleteOnu('onu-uuid-1', 'admin-id')).rejects.toThrow(BadRequestException);
      expect(onuRepo.delete).not.toHaveBeenCalled();
    });

    it('traduce DriverNotImplementedError a un 501 explícito para fabricantes sin soporte (ej. Huawei/HSGQ)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.deleteOnu.mockRejectedValue(new DriverNotImplementedError('HUAWEI', 'deleteOnu'));

      let caught: any;
      try {
        await service.deleteOnu('onu-uuid-1', 'admin-id');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught.getStatus()).toBe(501);
    });
  });

  describe('getOpticalHistory', () => {
    it('devuelve puntos históricos registrados cuando existen en la base de datos', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      opticalHistoryRepo.find.mockResolvedValue([
        {
          recordedAt: new Date('2026-10-10T12:00:00Z'),
          rxPowerDbm: -19.5,
          txPowerDbm: 2.3,
          attenuationDb: 17.2,
        },
        {
          recordedAt: new Date('2026-10-11T12:00:00Z'),
          rxPowerDbm: -19.8,
          txPowerDbm: 2.4,
          attenuationDb: 17.5,
        },
      ]);

      const history = await service.getOpticalHistory('onu-uuid-1', 30);

      expect(history).toHaveLength(2);
      expect(history[0].rxPowerDbm).toBe(-19.5);
      expect(history[1].attenuationDb).toBe(17.5);
    });

    it('devuelve puntos sintetizados si no hay histórico pero la ONU tiene potencia actual', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, rxPowerDbm: -20.1, txPowerDbm: 2.1 });
      opticalHistoryRepo.find.mockResolvedValue([]);

      const history = await service.getOpticalHistory('onu-uuid-1', 7);

      expect(history.length).toBeGreaterThanOrEqual(1);
      expect(history[0].rxPowerDbm).toBe(-20.1);
    });
  });

  describe('migrateOnu', () => {
    const activeOnu: Partial<OnuEntity> = {
      id: 'onu-uuid-1',
      oltId: 'olt-uuid-1',
      onuIndex: 'gpon-onu_1/1/1:2',
      serialNumber: 'ZTEGC0123456',
      vendor: 'ZTE',
      status: 'ACTIVE',
      olt: mockOlt as OltEntity,
      ponInterface: { id: 'iface-1', name: 'gpon-olt_1/1/1' } as any,
      napPortId: 'nap-port-old',
    };

    it('rechaza la migración si la ONU está en estado UNCONFIGURED', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });

      await expect(
        service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza la migración si el nuevo serial es idéntico al actual', async () => {
      onuRepo.findOne.mockResolvedValue({ ...activeOnu });

      await expect(
        service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC0123456' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza la migración si el nuevo serial ya está registrado en otra ONU', async () => {
      onuRepo.findOne
        .mockResolvedValueOnce({ ...activeOnu }) // findById
        .mockResolvedValueOnce({ id: 'another-onu-id', serialNumber: 'ZTEGC8888888' }); // duplicate check

      await expect(
        service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC8888888' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('migra exitosamente la ONU, libera puerto NAP anterior, reautoriza y configura GenieACS', async () => {
      onuRepo.findOne
        .mockResolvedValueOnce({ ...activeOnu, napPortId: 'nap-port-old' }) // findById inicial
        .mockResolvedValueOnce(null) // duplicate check -> no duplicado
        .mockResolvedValueOnce({ ...activeOnu, serialNumber: 'ZTEGC9999999', napPortId: 'nap-port-new' }); // findById final

      zteDriver.deleteOnu.mockResolvedValue({ ok: true });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      napPortRepo.findOne.mockResolvedValue({
        id: 'nap-port-new',
        portNumber: 2,
        status: 'DISPONIBLE',
        onuId: null,
      });

      const result = await service.migrateOnu('onu-uuid-1', {
        newSerialNumber: 'ZTEGC9999999',
        newNapPortId: 'nap-port-new',
        notes: 'Sustitución por daño eléctrico',
      });

      expect(result.success).toBe(true);
      expect(napPortRepo.update).toHaveBeenCalledWith('nap-port-old', {
        status: 'DISPONIBLE',
        onuId: null,
      });
      expect(napPortRepo.save).toHaveBeenCalled();
      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', expect.objectContaining({
        serialNumber: 'ZTEGC9999999',
        napPortId: 'nap-port-new',
      }));
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'PROVISION',
        status: 'SUCCESS',
      }));
    });
  });
});
