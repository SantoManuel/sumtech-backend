import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException, HttpException } from '@nestjs/common';
import { OnuWanProvisioningService } from './onu-wan-provisioning.service';
import { OnuManagementService } from './onu-management.service';
import { OltPartialOperationService } from './olt-partial-operation.service';
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
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';
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
  let genieAcsDeviceResolver: any;
  let tenantContext: any;
  let onuQueryBuilder: any;
  let wanProvisioning: any;

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
    onuTypeId: 'type-1',
    vendor: 'ZTE',
    status: 'UNCONFIGURED',
    olt: mockOlt as OltEntity,
    ponInterface: { id: 'iface-1', name: 'gpon-olt_1/1/1' } as any,
  };

  beforeEach(async () => {
    onuRepo = {
      // Default []: scanUnconfiguredOnus() usa find() para la reconciliación
      // inversa (limpiar filas "UNCONFIGURED" obsoletas) -- sin este default
      // los tests que no la mockean explícitamente truenan con
      // "cannot read property 'filter' of undefined" en vez de simplemente
      // no encontrar nada que limpiar.
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      save: jest.fn((entity) => Promise.resolve({ ...entity, id: entity.id || 'saved-onu-id' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn((entities) => Promise.resolve(entities)),
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
      save: jest.fn().mockImplementation((val) => Promise.resolve(val)),
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
      generateTr069ManagementScript: jest.fn(),
      generateTr069ProfileScript: jest.fn(),
      authorizeOnu: jest.fn(),
      applyTr069Management: jest.fn(),
      updateTr069AcsUrl: jest.fn(),
      batchUpdateTr069AcsUrl: jest.fn(),
      setOnuAdminState: jest.fn(),
      deleteOnu: jest.fn(),
      getOnuDetailInfo: jest.fn(),
      getOnuIpHost: jest.fn(),
      getOnuWanIp: jest.fn(),
      getOnuTr069MgmtInfo: jest.fn(),
      getOnuMacTable: jest.fn(),
      applyWanIpFix: jest.fn(),
      applyServiceGemportFix: jest.fn(),
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
      configureCpe: jest.fn().mockResolvedValue({ success: true, applicationStatus: 'APPLIED', deviceId: 'dev-1', appliedParametersCount: 3, verification: {}, message: 'ok' }),
    };

    genieAcsDeviceResolver = {
      findByContractId: jest.fn().mockResolvedValue(null),
      resolveBySerialNumber: jest.fn().mockResolvedValue(null),
    };

    tenantContext = {
      getSlug: jest.fn().mockReturnValue('sumtech'),
    };

    wanProvisioning = { withMutation: (_id: string, callback: () => Promise<any>) => callback(), assertLegacyWanRecovery: jest.fn(), latestOperation: jest.fn().mockResolvedValue(null), invalidateReplacement: jest.fn(), capabilities: jest.fn().mockReturnValue({}), configure: jest.fn().mockResolvedValue({ id: 'op-1', status: 'APPLIED', lastError: null }) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuManagementService,
        { provide: OnuWanProvisioningService, useValue: wanProvisioning },
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
        { provide: GenieAcsDeviceResolverService, useValue: genieAcsDeviceResolver },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: OltPartialOperationService, useValue: { record: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<OnuManagementService>(OnuManagementService);
  });

  it('debe estar definido', () => {
    expect(service).toBeDefined();
  });

  describe('protecciones de autorización', () => {
    const dto = { onuTypeId: 'type-1', serviceVlanId: 'vlan-1' };

    it.each([
      ['PON ausente', { ponInterface: null }],
      ['índice inválido', { onuIndex: '1x' }],
      ['PON inconsistente', { onuIndex: 'gpon-onu_1/2/1:1' }],
      ['serial con salto de línea', { serialNumber: 'SN\nwrite' }],
    ])('rechaza %s antes de autorizar', async (_label, changes) => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, ...changes });
      await expect(service.authorizeOnu('onu-uuid-1', dto)).rejects.toThrow(BadRequestException);
      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
    });

    it('rechaza tipo o VLAN inexistentes antes de generar el script', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu });
      onuTypeRepo.findOneBy.mockResolvedValueOnce(null);
      await expect(service.previewAuthorizationScript('onu-uuid-1', dto)).rejects.toThrow(BadRequestException);
      vlanRepo.findOneBy.mockResolvedValueOnce(null);
      await expect(service.previewAuthorizationScript('onu-uuid-1', dto)).rejects.toThrow(BadRequestException);
      expect(zteDriver.generateAuthorizationScript).not.toHaveBeenCalled();
    });

    it('rechaza ID explícito inválido sin usar el índice como respaldo', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu });
      await expect(service.previewAuthorizationScript('onu-uuid-1', { ...dto, onuId: '1x' })).rejects.toThrow(BadRequestException);
      expect(zteDriver.generateAuthorizationScript).not.toHaveBeenCalled();
    });
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

    it('con search sanitiza con trim y aplica buscador 360° incluyendo onu.name y onu.description de la OLT', async () => {
      await service.findAll({ search: '  Test_3  ' } as any);

      expect(onuQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('onu.name ILIKE :q'),
        expect.objectContaining({
          q: '%Test_3%',
          cleanQ: '%Test_3%',
        }),
      );
    });

    it('con search de MAC o serial con dos puntos, genera cleanQ sin separadores', async () => {
      await service.findAll({ search: 'b4:54:59:6f:12:04' } as any);

      expect(onuQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('REPLACE(onu.serialNumber, \':\', \'\') ILIKE :cleanQ'),
        expect.objectContaining({
          q: '%b4:54:59:6f:12:04%',
          cleanQ: '%b454596f1204%',
        }),
      );
    });

    it('usa alias en minúsculas para los joins de ponInterface/onuType -- regresión: un alias con mayúsculas intercaladas (ej. "ponInterface") llega SIN comillas a Postgres dentro de un .andWhere() crudo, que lo pasa a minúsculas y ya no coincide con el alias real del JOIN, reventando con "missing FROM-clause entry for table poninterface" en producción contra cualquier OLT (confirmado 2026-10-28)', async () => {
      await service.findAll({ search: 'ECOM0F91DF9B' } as any);

      expect(onuQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('onu.ponInterface', 'poninterface');
      expect(onuQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('onu.onuType', 'onutype');

      const searchCall = onuQueryBuilder.andWhere.mock.calls.find(([sql]: [string]) => sql.includes('ILIKE'));
      expect(searchCall).toBeDefined();
      const [searchSql] = searchCall;

      // El alias de la condición de búsqueda debe coincidir EXACTO (mismo
      // case) con el alias usado en el JOIN -- nunca "ponInterface."/"onuType."
      // sueltos sin comillas.
      expect(searchSql).toContain('poninterface.name ILIKE');
      expect(searchSql).toContain('onutype.model ILIKE');
      expect(searchSql).not.toMatch(/\bponInterface\./);
      expect(searchSql).not.toMatch(/\bonuType\./);
    });

    it('busca por onutype.model, no "modelName" -- OnuTypeEntity nunca tuvo esa propiedad; TypeORM no la traduce y Postgres revienta con "column does not exist" en cuanto se arregla el alias (bug real confirmado en producción 2026-10-28, posterior al fix de alias)', async () => {
      await service.findAll({ search: 'F660' } as any);

      const searchCall = onuQueryBuilder.andWhere.mock.calls.find(([sql]: [string]) => sql.includes('ILIKE'));
      const [searchSql] = searchCall;
      expect(searchSql).not.toMatch(/\bmodelName\b/);
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

    it('limpia una fila "UNCONFIGURED" que la OLT YA NO reporta -- bug real confirmado (2026-10-23): una ONU autorizada por fuera de la app (ej. directo por Telnet) se quedaba para siempre en la Bandeja Sin Configurar', async () => {
      // La OLT ya no reporta NADA sin configurar en este escaneo.
      zteDriver.getUnconfiguredOnus.mockResolvedValue([]);
      const staleRow = { id: 'onu-stale-1', oltId: 'olt-uuid-1', status: 'UNCONFIGURED', serialNumber: 'CMDCDD4D131E' };
      onuRepo.find.mockResolvedValue([staleRow]);

      await service.scanUnconfiguredOnus('olt-uuid-1', 'admin-id');

      expect(onuRepo.find).toHaveBeenCalledWith({ where: { oltId: 'olt-uuid-1', status: 'UNCONFIGURED' } });
      expect(onuRepo.remove).toHaveBeenCalledWith([staleRow]);
    });

    it('NO limpia una fila "UNCONFIGURED" que la OLT SIGUE reportando en este mismo escaneo', async () => {
      zteDriver.getUnconfiguredOnus.mockResolvedValue([
        { onuIndex: 'gpon-onu_1/1/1:1', serialNumber: 'ZTEGC0123456', vendor: 'ZTE', ponInterface: 'gpon-olt_1/1/1' },
      ]);
      const stillUnconfigured = { id: 'onu-uuid-1', oltId: 'olt-uuid-1', status: 'UNCONFIGURED', serialNumber: 'ZTEGC0123456' };
      onuRepo.findOneBy.mockResolvedValue(stillUnconfigured);
      onuRepo.find.mockResolvedValue([stillUnconfigured]);

      await service.scanUnconfiguredOnus('olt-uuid-1', 'admin-id');

      expect(onuRepo.remove).not.toHaveBeenCalled();
    });

    it('no revienta el escaneo si falla la limpieza de filas obsoletas -- mejor esfuerzo, el resto del resultado del escaneo ya es válido', async () => {
      zteDriver.getUnconfiguredOnus.mockResolvedValue([]);
      onuRepo.find.mockResolvedValue([{ id: 'onu-stale-1', oltId: 'olt-uuid-1', status: 'UNCONFIGURED', serialNumber: 'CMDCDD4D131E' }]);
      onuRepo.remove.mockRejectedValue(new Error('FK constraint violation'));

      await expect(service.scanUnconfiguredOnus('olt-uuid-1', 'admin-id')).resolves.toEqual([]);
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

  describe('getProvisioningAudit -- pestaña de Auditoría de Aprovisionamiento (ver Plan_Implementacion_Auditoria_Aprovisionamiento_ONU.md)', () => {
    const auditOnu = {
      ...mockOnu,
      onuIndex: 'gpon-onu_1/2/6:3',
      ponInterface: { id: 'iface-1', name: 'gpon-olt_1/2/6' },
      authorizedAt: new Date('2026-10-29T12:00:00Z'),
      onuType: { vendorTypeName: 'HUAWEY-BT546XG-TR069', supportsEthuniDhcpDelegation: false, supportsSecurityMgmt: false },
      serviceConfig: {
        serviceVlan: { vlanId: 400 },
        tr069Vlan: { vlanId: 4069 },
        tr069Network: { acsUrl: 'http://10.254.0.1:7547' },
      },
    };

    it('marca CRÍTICO cuando Config state ≠ success', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'fail', phaseState: 'working', raw: 'Config state: fail' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find((f) => f.severity === 'CRITICAL' && f.message.includes('Config state'));
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBe('REAPPLY_TR069');
    });

    it('marca CRÍTICO cuando el tipo de ONU reportado por la OLT no coincide con el esperado', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'EG8141A5-TR069', configState: 'success', phaseState: 'working', raw: 'Type: EG8141A5-TR069' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find(
        (f) => f.severity === 'CRITICAL' && f.message.includes('EG8141A5-TR069') && f.message.includes('HUAWEY-BT546XG-TR069'),
      );
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBe('REAUTHORIZE');
    });

    it('marca CRÍTICO cuando la IP de gestión (Host ID: 2, ip-host) es 0.0.0.0/sin asignar', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: undefined, serviceIp: '10.46.10.15', ipHostFound: true, raw: 'Host ID: 1\nIP: 10.46.10.15\nHost ID: 2\nIP: 0.0.0.0' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find((f) => f.severity === 'CRITICAL' && f.message.includes('DHCP') && f.message.includes('gestión'));
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBe('REAPPLY_TR069');
      // Host 1 (servicio) sí tiene IP en este escenario -- no debe disparar su hallazgo.
      expect(result.findings.some((f) => f.message.includes('SERVICIO'))).toBe(false);
    });

    it('marca CRÍTICO cuando la IP de SERVICIO (Host ID: 1, ip-host) es 0.0.0.0/sin asignar -- bug real: el audit original solo rastreaba Host 2, dejando invisible una falla en el canal de internet del cliente', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: undefined, ipHostFound: true, raw: 'Host ID: 1\nIP: 0.0.0.0\nHost ID: 2\nIP: 10.46.0.247' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find((f) => f.severity === 'CRITICAL' && f.message.includes('SERVICIO'));
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBe('REAUTHORIZE');
    });

    it('marca CRÍTICO sin fixAction cuando "Phase state" no es "working" (ej. LOS) -- capa física, ningún botón de software lo soluciona', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'LOS', raw: 'Phase state: LOS' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: undefined, serviceIp: undefined, ipHostFound: true, raw: 'Host ID: 1\nIP: 0.0.0.0\nHost ID: 2\nIP: 0.0.0.0' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find((f) => f.severity === 'CRITICAL' && f.message.includes('LOS'));
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBeUndefined();
      expect(finding?.message).toContain('óptica');
    });

    it('ofrece las Opciones A (APPLY_WAN_IP) y B (APPLY_SERVICE_GEMPORT) cuando NINGÚN host (ni servicio ni gestión) tiene IP', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: undefined, serviceIp: undefined, ipHostFound: true, raw: 'Host ID: 1\nIP: 0.0.0.0\nHost ID: 2\nIP: 0.0.0.0' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const optionA = result.findings.find((f) => f.fixAction === 'APPLY_WAN_IP');
      const optionB = result.findings.find((f) => f.fixAction === 'APPLY_SERVICE_GEMPORT');
      expect(optionA).toBeDefined();
      expect(optionA?.severity).toBe('CRITICAL');
      expect(optionB).toBeDefined();
      expect(optionB?.severity).toBe('WARNING');
    });

    it('NO ofrece las Opciones A/B si al menos un host sí tiene IP', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: undefined, ipHostFound: true, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      expect(result.findings.some((f) => f.fixAction === 'APPLY_WAN_IP')).toBe(false);
      expect(result.findings.some((f) => f.fixAction === 'APPLY_SERVICE_GEMPORT')).toBe(false);
    });

    it('REGRESIÓN (bug real confirmado en vivo, 2026-10-29, ONU ECOM0F91DF9B): "show ... wan-ip" devolviendo "%Code 64040 : No relate information to show" NO debe marcar crítico si ip-host SÍ tiene IP real -- wan-ip solo aplica al mecanismo todavía no implementado (Plan_Implementacion_WanIp_VlanProfile_HGU.md)', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: 'IP: 10.46.0.247' });
      zteDriver.getOnuWanIp.mockResolvedValue({ host1: undefined, host2: undefined, raw: '%Code 64040-GPONRM : No relate information to show.' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      expect(result.findings.some((f) => f.severity === 'CRITICAL')).toBe(false);
    });

    it('marca ADVERTENCIA cuando el ACS aplicado no coincide con la Red TR-069 esperada', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: 'Host ID: 1\nIP: 10.46.10.15\nHost ID: 2\nIP: 10.46.0.247' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://otro-acs-viejo:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      const finding = result.findings.find((f) => f.severity === 'WARNING' && f.message.includes('ACS'));
      expect(finding).toBeDefined();
      expect(finding?.fixAction).toBe('REAPPLY_TR069');
    });

    it('marca ADVERTENCIA cuando una VLAN esperada no tiene ninguna MAC aprendida', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }]); // falta la 4069

      const result = await service.getProvisioningAudit('onu-uuid-1');

      expect(result.findings.some((f) => f.severity === 'WARNING' && f.message.includes('4069'))).toBe(true);
    });

    it('todo en orden: reporta un único hallazgo INFO sin discrepancias', async () => {
      onuRepo.findOne.mockResolvedValue({
        ...auditOnu,
        onuType: { vendorTypeName: 'HUAWEY-BT546XG-TR069', supportsEthuniDhcpDelegation: true, supportsSecurityMgmt: true },
      });
      zteDriver.getOnuDetailInfo.mockResolvedValue({ type: 'HUAWEY-BT546XG-TR069', configState: 'success', phaseState: 'working', raw: '' });
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: 'Host ID: 1\nIP: 10.46.10.15\nHost ID: 2\nIP: 10.46.0.247' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });
      zteDriver.getOnuTr069MgmtInfo.mockResolvedValue({ acsUrl: 'http://10.254.0.1:7547', raw: '' });
      zteDriver.getOnuMacTable.mockResolvedValue([{ mac: 'aa', vlan: 400 }, { mac: 'bb', vlan: 4069 }]);

      const result = await service.getProvisioningAudit('onu-uuid-1');

      expect(result.findings).toEqual([{ severity: 'INFO', message: expect.stringContaining('No se detectaron') }]);
    });

    it('un driver que no implementa estos métodos opcionales (ej. HiOSO) reporta "unsupported" en vez de reventar', async () => {
      onuRepo.findOne.mockResolvedValue(auditOnu);
      delete zteDriver.getOnuDetailInfo;
      delete zteDriver.getOnuIpHost;
      delete zteDriver.getOnuWanIp;
      delete zteDriver.getOnuTr069MgmtInfo;
      delete zteDriver.getOnuMacTable;

      const result = await service.getProvisioningAudit('onu-uuid-1');

      expect(result.unsupported).toEqual(
        expect.arrayContaining(['getOnuDetailInfo', 'getOnuIpHost', 'getOnuWanIp', 'getOnuTr069MgmtInfo', 'getOnuMacTable']),
      );
      expect(result.findings.every((f) => f.severity !== 'CRITICAL')).toBe(true);
    });
  });

  describe('resolveLiveManagementIp -- consulta en vivo a la OLT la IP que la ONU ya obtuvo (usada por OnuWebProxyService para abrir la GUI remota sin depender de GenieACS)', () => {
    it('devuelve mgmtIp de getOnuIpHost si está presente y no es 0.0.0.0', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '10.46.0.247', serviceIp: '10.46.10.15', ipHostFound: true, raw: '' });

      const ip = await service.resolveLiveManagementIp('onu-uuid-1');

      expect(ip).toBe('10.46.0.247');
      expect(zteDriver.getOnuWanIp).not.toHaveBeenCalled();
    });

    it('si mgmtIp es 0.0.0.0/undefined pero serviceIp sí tiene valor, usa serviceIp', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: '0.0.0.0', serviceIp: '10.46.10.15', ipHostFound: true, raw: '' });

      const ip = await service.resolveLiveManagementIp('onu-uuid-1');

      expect(ip).toBe('10.46.10.15');
    });

    it('si getOnuIpHost no reporta nada útil, cae a getOnuWanIp (host2 antes que host1)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: undefined, serviceIp: undefined, ipHostFound: false, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ host1: { ip: '10.46.10.15' }, host2: { ip: '10.46.0.247' }, raw: '' });

      const ip = await service.resolveLiveManagementIp('onu-uuid-1');

      expect(ip).toBe('10.46.0.247');
    });

    it('devuelve null (sin reventar) si ningún método reporta una IP real', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.getOnuIpHost.mockResolvedValue({ mgmtIp: undefined, serviceIp: undefined, ipHostFound: false, raw: '' });
      zteDriver.getOnuWanIp.mockResolvedValue({ raw: '' });

      const ip = await service.resolveLiveManagementIp('onu-uuid-1');

      expect(ip).toBeNull();
    });

    it('devuelve null si el fabricante no implementa estos métodos (ej. Huawei, driver sin implementar) en vez de lanzar', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      delete zteDriver.getOnuIpHost;
      delete zteDriver.getOnuWanIp;

      const ip = await service.resolveLiveManagementIp('onu-uuid-1');

      expect(ip).toBeNull();
    });

    it('devuelve null (sin reventar) si la ONU no existe o la OLT no es alcanzable', async () => {
      onuRepo.findOne.mockResolvedValue(null);

      const ip = await service.resolveLiveManagementIp('onu-inexistente');

      expect(ip).toBeNull();
    });
  });

  describe('applyWanIpFix -- Opción A de recuperación de IP ("Reaplicar wan-ip"), CONFIRMADA EN VIVO (2026-10-30, ONU ECOM0F91DF9B)', () => {
    const fixOnu = {
      ...mockOnu,
      onuIndex: 'gpon-onu_1/2/6:2',
      ponInterface: { id: 'iface-1', name: 'gpon-olt_1/2/6' } as any,
      serviceConfig: { serviceVlan: { vlanId: 400 }, tr069Vlan: { vlanId: 4069 } },
    };

    it('llama driver.applyWanIpFix con la VLAN de servicio y gestión de la ONU', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      zteDriver.applyWanIpFix.mockResolvedValue({ ok: true });

      const result = await service.applyWanIpFix('onu-uuid-1');

      expect(zteDriver.applyWanIpFix).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.10' }),
        'gpon-olt_1/2/6',
        2,
        { serviceVlan: 400, tr069Vlan: 4069 },
      );
      expect(result.success).toBe(true);
    });

    it('lanza BadRequestException con el mensaje de la OLT si la rechaza', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      zteDriver.applyWanIpFix.mockResolvedValue({ ok: false, error: '% Unknown command' });

      await expect(service.applyWanIpFix('onu-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el driver no soporta esta corrección', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      delete zteDriver.applyWanIpFix;

      await expect(service.applyWanIpFix('onu-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si la ONU no tiene VLAN de servicio configurada', async () => {
      onuRepo.findOne.mockResolvedValue({ ...fixOnu, serviceConfig: { tr069Vlan: { vlanId: 4069 } } });

      await expect(service.applyWanIpFix('onu-uuid-1')).rejects.toThrow(BadRequestException);
      expect(zteDriver.applyWanIpFix).not.toHaveBeenCalled();
    });
  });

  describe('applyServiceGemportFix -- Opción B ("último recurso") de recuperación de IP, CONFIRMADA EN VIVO (2026-10-30, ONU ECOM0F91DF9B)', () => {
    const fixOnu = {
      ...mockOnu,
      onuIndex: 'gpon-onu_1/2/6:2',
      ponInterface: { id: 'iface-1', name: 'gpon-olt_1/2/6' } as any,
      serviceConfig: { serviceVlan: { vlanId: 400 }, tr069Vlan: { vlanId: 4069 } },
    };

    it('llama driver.applyServiceGemportFix con la VLAN de servicio y gestión de la ONU', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      zteDriver.applyServiceGemportFix.mockResolvedValue({ ok: true });

      const result = await service.applyServiceGemportFix('onu-uuid-1');

      expect(zteDriver.applyServiceGemportFix).toHaveBeenCalledWith(
        expect.objectContaining({ host: '10.0.0.10' }),
        'gpon-olt_1/2/6',
        2,
        { serviceVlan: 400, tr069Vlan: 4069 },
      );
      expect(result.success).toBe(true);
    });

    it('lanza BadRequestException con el mensaje de la OLT si la rechaza', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      zteDriver.applyServiceGemportFix.mockResolvedValue({ ok: false, error: '% Unknown command' });

      await expect(service.applyServiceGemportFix('onu-uuid-1')).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el driver no soporta esta corrección', async () => {
      onuRepo.findOne.mockResolvedValue(fixOnu);
      delete zteDriver.applyServiceGemportFix;

      await expect(service.applyServiceGemportFix('onu-uuid-1')).rejects.toThrow(BadRequestException);
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

    it('sin tr069NetworkId en el dto, crea onu_service_config con managementMethod "OMCI" y nada de TR-069 -- wanMode sigue siendo exclusivo de pushWanConfig (Etapa 3)', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        operationMode: 'ROUTER',
        speedProfileId: '',
      });

      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceVlanId: 'vlan-1',
          operationMode: 'ROUTER',
          managementMethod: 'OMCI',
          tr069NetworkId: undefined,
          speedProfileId: undefined,
        }),
      );
      // Ya no manda nada de TR-069/WAN al driver tampoco.
      expect(zteDriver.authorizeOnu).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ tr069Url: expect.anything() }),
      );
    });

    it('CON tr069NetworkId en el dto (Etapa 1 fusionada), crea onu_service_config con managementMethod "TR069" + tr069NetworkId + tr069VlanId -- sin esto la Ficha 360 mostraba "OMCI"/"VLAN —" pese a que el driver YA aplicó TR-069 en la OLT', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      tr069Repo.findOneBy.mockResolvedValue({ id: 'tr069-1', vlanId: 'vlan-uuid-46', acsUrl: 'http://10.254.0.1:7547' });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        operationMode: 'ROUTER',
        tr069NetworkId: 'tr069-1',
        managementMethod: 'TR069',
      });

      expect(tr069Repo.findOneBy).toHaveBeenCalledWith({ id: 'tr069-1' });
      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          managementMethod: 'TR069',
          tr069NetworkId: 'tr069-1',
          tr069VlanId: 'vlan-uuid-46',
        }),
      );
    });

    it('re-autorizar una ONU existente SIN tr069NetworkId en el dto no toca managementMethod/tr069NetworkId -- pero si esta vez SÍ trae una Red TR-069, la actualiza (igual que applyTr069Profile)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({
        onuId: 'onu-uuid-1',
        serviceVlanId: 'vlan-old',
        managementMethod: 'OMCI',
        tr069NetworkId: undefined,
        operationMode: 'ROUTER',
        appliedVersion: 1,
        desiredVersion: 1,
      });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      tr069Repo.findOneBy.mockResolvedValue({ id: 'tr069-2', vlanId: 'vlan-uuid-99', acsUrl: 'http://10.254.0.1:7547' });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-2',
        onuTypeId: 'type-1',
        tr069NetworkId: 'tr069-2',
        managementMethod: 'TR069',
      });

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceVlanId: 'vlan-2',
          managementMethod: 'TR069',
          tr069NetworkId: 'tr069-2',
          tr069VlanId: 'vlan-uuid-99',
        }),
      );
    });

    it('re-autorizar una ONU existente NO pisa managementMethod/tr069NetworkId/wanMode ya aplicados por las Etapas 2/3', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({
        onuId: 'onu-uuid-1',
        serviceVlanId: 'vlan-old',
        managementMethod: 'TR069',
        tr069NetworkId: 'tr069-1',
        wanMode: 'PPPOE',
        operationMode: 'ROUTER',
        appliedVersion: 1,
        desiredVersion: 1,
      });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-2', onuTypeId: 'type-1' }, 'admin-id');

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceVlanId: 'vlan-2',
          managementMethod: 'TR069',
          tr069NetworkId: 'tr069-1',
          wanMode: 'PPPOE',
          applyStatus: 'PENDING',
          appliedVersion: 1,
          desiredVersion: 2,
          lastApplyError: expect.stringContaining('no se reaplicó'),
        }),
      );
    });

    it('conserva la versión aplicada y reporta advertencias del driver como pendientes', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ onuId: mockOnu.id, appliedVersion: 2, desiredVersion: 3 });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true, warning: 'rechazo parcial' });

      const result = await service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' });

      expect(result.oltWarning).toContain('rechazo parcial');
      expect((service as any).partialOperations.record).toHaveBeenCalledWith(expect.objectContaining({
        onuId: mockOnu.id, operation: 'authorizeOnu', expectedState: 'PRESENT',
      }));
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'PENDING', appliedVersion: 2, desiredVersion: 4, lastApplyError: 'rechazo parcial',
      }));
    });

    it('trata advertencias cosméticas de OMCI (unknown ME en security-mgmt o dhcp-ip ethuni) como APPLIED y auto-aprende en OnuType', async () => {
      const mockType = { id: 'type-1', model: 'HG8546M', supportsSecurityMgmt: true, supportsEthuniDhcpDelegation: true };
      onuTypeRepo.findOneBy.mockResolvedValue(mockType);
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, onuTypeId: 'type-1' });
      configRepo.findOneBy.mockResolvedValue({ onuId: mockOnu.id, appliedVersion: 1, desiredVersion: 1 });
      const cosmeticWarning = 'La OLT rechazó la configuración secundaria de gestión ("security-mgmt 998"): %Code 63993-GPONRM : ONT return error:unknown ME.. El canal de internet sí quedó activo.';
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true, warning: cosmeticWarning });

      const result = await service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' });

      expect(result.oltWarning).toContain('security-mgmt');
      expect((service as any).partialOperations.record).not.toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'APPLIED', appliedVersion: 2, desiredVersion: 2, lastApplyError: null,
      }));
      expect(onuTypeRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        id: 'type-1', supportsSecurityMgmt: false,
      }));
    });

    it('preserva el error del driver si también fallan el registro y el guardado de estado', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ onuId: mockOnu.id, appliedVersion: 1, desiredVersion: 1 });
      const original = new Error('error original');
      zteDriver.authorizeOnu.mockRejectedValue(original);
      (service as any).partialOperations.record.mockRejectedValue(new Error('registro falló'));
      configRepo.save.mockRejectedValue(new Error('guardado falló'));
      await expect(service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' })).rejects.toBe(original);
    });

    it('una autorización nueva con advertencia no declara ninguna versión aplicada', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true, warning: 'confirmación incompleta' });

      await service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' });
      expect(configRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'PENDING', appliedVersion: 0, desiredVersion: 1, lastApplyError: 'confirmación incompleta',
      }));
    });

    it.each(['rechazo', 'excepción'])('registra ERROR sin avanzar la versión aplicada ante %s', async (caso) => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ onuId: mockOnu.id, appliedVersion: 2, desiredVersion: 2 });
      if (caso === 'rechazo') zteDriver.authorizeOnu.mockResolvedValue({ ok: false, error: 'fallo OLT' });
      else zteDriver.authorizeOnu.mockRejectedValue(new Error('fallo OLT'));

      await expect(service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' })).rejects.toThrow('fallo OLT');
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'ERROR', appliedVersion: 2, desiredVersion: 3, lastApplyError: 'fallo OLT',
      }));
      expect(onuRepo.update).not.toHaveBeenCalled();
    });

    it('limpia la advertencia anterior cuando la autorización queda confirmada', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ onuId: mockOnu.id, appliedVersion: 1, desiredVersion: 2, lastApplyError: 'anterior' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1', onuTypeId: 'type-1' });
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'APPLIED', appliedVersion: 3, desiredVersion: 3, lastApplyError: null,
      }));
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

    it('prioriza tcontProfile y trafficProfile explícitos pasados desde el modal con dos dropdowns', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await service.authorizeOnu('onu-uuid-1', {
        serviceVlanId: 'vlan-1',
        onuTypeId: 'type-1',
        tcontProfile: 'SMARTOLT-100M-UP',
        trafficProfile: 'TRAFFIC-108M',
        managementMethod: 'OMCI',
        operationMode: 'ROUTER',
      });

      expect(zteDriver.authorizeOnu).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tcontProfile: 'SMARTOLT-100M-UP',
          trafficProfile: 'TRAFFIC-108M',
          downKbps: 110592,
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

    it('genera trafficProfile con la convención "TRAFFIC-<Mbps>M" si el perfil NO tiene vendorTrafficProfile configurado -- bug real confirmado en producción (2026-10-22): los ~40 perfiles "SMARTOLT-*-UP" importados por descubrimiento TCONT nunca lo traían, así que el cliente quedaba con la bajada sin gestionar en la OLT', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });
      speedProfileRepo.findOneBy.mockResolvedValueOnce({
        id: 'profile-1',
        code: 'SMARTOLT-100M-UP',
        downKbps: 102400,
        upKbps: 102400,
        vendorTcontProfile: 'SMARTOLT-100M-UP',
        // vendorTrafficProfile deliberadamente ausente -- caso real de un
        // perfil importado por "Ver Perfiles TCONT Reales de una OLT".
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

    it('NUNCA llama a CpeConfiguratorService ni toca GenieACS -- eso es ahora applyTr069Profile/pushWanConfig (Etapas 2/3), sin importar qué venga en el dto', async () => {
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

      expect(cpeConfiguratorService.configureCpe).not.toHaveBeenCalled();
      expect((result as any).cpeConfigured).toBeUndefined();
      expect((result as any).cpeConfigWarning).toBeUndefined();
    });

    it('lanza BadRequestException si el driver de la OLT falla aprovisionando', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      zteDriver.authorizeOnu.mockResolvedValue({ ok: false, error: 'ONU index already in use' });

      await expect(
        service.authorizeOnu('onu-uuid-1', { serviceVlanId: 'vlan-1' }, 'admin-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('applyTr069Profile (Etapa 2: apuntar la ONU al ACS)', () => {
    const mockConfig = {
      onuId: 'onu-uuid-1',
      serviceVlanId: 'vlan-1',
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
      wanMode: 'PPPOE',
      appliedVersion: 1,
      desiredVersion: 1,
    };

    // Decisión de negocio (2026-11-07): el bloque TR-069 no lee serviceVlanId/
    // speedProfileId/onuTypeId para generarse -- ya NO se exige una fila de
    // config previa en net.onu_service_config. Aplica a cualquier ONU que la
    // OLT ya reporte autorizada (status ACTIVE), sin importar si la
    // autorización óptica la hizo este sistema o fue detectada/importada
    // externamente (ej. detectedBy=OLT_IMPORT).
    it('ya NO exige config previa -- aplica el perfil a cualquier ONU ACTIVE, creando una fila mínima si no existía', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      configRepo.findOneBy.mockResolvedValue(null);
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true });

      const result = await service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' }, 'admin-id');

      expect(zteDriver.applyTr069Management).toHaveBeenCalled();
      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ onuId: 'onu-uuid-1', managementMethod: 'TR069', operationMode: 'ROUTER' }),
      );
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ managementMethod: 'TR069', tr069NetworkId: 'tr069-1' }),
      );
      expect((result as any).tr069Warning).toBeUndefined();
    });

    it('rechaza si la ONU todavía no está autorizada ópticamente en la OLT (status distinto de ACTIVE), config exista o no', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      configRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(/autorizada/);
      expect(zteDriver.applyTr069Management).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si no se selecciona Red TR-069', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      await expect(service.applyTr069Profile('onu-uuid-1', {} as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException SIN llamar al driver si la Red TR-069 tiene "acsUrl" vacío -- nunca debe generarse "tr069-mgmt 1 acs " en blanco', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      tr069Repo.findOne.mockResolvedValue({ id: 'tr069-1', vlanId: 46, acsUrl: '', vlan: { vlanId: 46 } });

      await expect(
        service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(zteDriver.applyTr069Management).not.toHaveBeenCalled();
    });

    it('llama a driver.applyTr069Management() con los parámetros resueltos y persiste managementMethod/tr069NetworkId', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true });

      const result = await service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' }, 'admin-id');

      expect(zteDriver.applyTr069Management).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          serviceVlan: 200,
          managementMethod: 'TR069',
          tr069Url: 'http://10.46.0.1:7547/',
          tr069Vlan: 46,
        }),
      );
      expect(configRepo.save).toHaveBeenCalledWith(
        // tr069VlanId: bug real confirmado (2026-10-23) -- nunca se asignaba,
        // así que "VLAN TR-069" en la Ficha 360 siempre salía vacía pese a
        // que findById() ya carga la relación "serviceConfig.tr069Vlan".
        expect.objectContaining({ managementMethod: 'TR069', tr069NetworkId: 'tr069-1', tr069VlanId: 46 }),
      );
      expect((result as any).tr069Warning).toBeUndefined();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROVISION', status: 'SUCCESS' }),
      );
    });

    it('rechaza la Red TR-069 sin VLAN antes de ejecutar el driver', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      tr069Repo.findOneBy.mockResolvedValue({ id: 'tr069-1', vlanId: undefined, acsUrl: 'http://10.46.0.1:7547/' });
      tr069Repo.findOne.mockResolvedValue({ id: 'tr069-1', acsUrl: 'http://10.46.0.1:7547/', vlan: null });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true });

      await expect(service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' })).rejects.toThrow(/VLAN/);
      expect(zteDriver.applyTr069Management).not.toHaveBeenCalled();
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('propaga el warning de mejor esfuerzo del driver sin fallar', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true, warning: 'La OLT rechazó tr069-mgmt' });

      const result = await service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' });

      expect((result as any).tr069Warning).toBe('La OLT rechazó tr069-mgmt');
      expect((service as any).partialOperations.record).toHaveBeenCalledWith(expect.objectContaining({
        onuId: mockOnu.id, operation: 'applyTr069Profile', expectedState: 'PRESENT',
      }));
    });

    it('un éxito limpio (sin warning) SÍ resuelve un pendiente previo -- bug real confirmado (2026-11-03): antes esta rama solo existía para el caso con warning, así que "Estado de Aprovisionamiento (OLT)" se quedaba perpetuamente desincronizado aunque la OLT confirmara el cambio. Mismo criterio simétrico que ya usa authorizeOnu()', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig, applyStatus: 'PENDING', desiredVersion: 3, appliedVersion: 1, lastApplyError: 'warning anterior' });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true });
      await service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' });
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'APPLIED', desiredVersion: 4, appliedVersion: 4, lastApplyError: null,
      }));
    });

    it('si el driver reporta warning (Config state no confiable tras el polling), SÍ bumpea desiredVersion pero deja applyStatus en PENDING sin tocar appliedVersion', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig, applyStatus: 'APPLIED', desiredVersion: 1, appliedVersion: 1 });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: true, warning: 'El "Config state" del ONT quedó en "fail"' });
      await service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' });
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({
        applyStatus: 'PENDING', desiredVersion: 2, appliedVersion: 1, lastApplyError: 'El "Config state" del ONT quedó en "fail"',
      }));
    });

    it('lanza BadRequestException si el driver falla (ok:false)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.applyTr069Management.mockResolvedValue({ ok: false, error: 'Timeout de Telnet' });

      await expect(
        service.applyTr069Profile('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('previewTr069ProfileScript (vista previa/dry-run de Etapa 2 -- misma funcionalidad que previewAuthorizationScript para Etapa 1, pedida explícitamente para el modal "Aplicar Perfil TR-069")', () => {
    const mockConfig = {
      onuId: 'onu-uuid-1',
      serviceVlanId: 'vlan-1',
      managementMethod: 'OMCI',
      operationMode: 'ROUTER',
      wanMode: 'PPPOE',
      appliedVersion: 1,
      desiredVersion: 1,
    };

    it('ya NO exige config previa -- previsualiza el script para cualquier ONU ACTIVE, sin crear/persistir nada', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE' });
      configRepo.findOneBy.mockResolvedValue(null);
      zteDriver.generateTr069ProfileScript.mockReturnValue(['configure terminal', 'pon-onu-mng gpon-onu_1/1/1:1']);

      const preview = await service.previewTr069ProfileScript('onu-uuid-1', { tr069NetworkId: 'tr069-1' });

      expect(zteDriver.generateTr069ProfileScript).toHaveBeenCalled();
      expect(preview.commands).toHaveLength(2);
      expect(configRepo.create).not.toHaveBeenCalled();
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('reutiliza la MISMA validación de estado que applyTr069Profile: rechaza si la ONU no está ACTIVE, sin llamar al driver', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'UNCONFIGURED' });
      configRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.previewTr069ProfileScript('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(zteDriver.generateTr069ProfileScript).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si no se selecciona Red TR-069', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      await expect(service.previewTr069ProfileScript('onu-uuid-1', {} as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException SIN llamar al driver si la Red TR-069 tiene "acsUrl" vacío -- misma guarda que applyTr069Profile', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      tr069Repo.findOne.mockResolvedValue({ id: 'tr069-1', vlanId: 46, acsUrl: '', vlan: { vlanId: 46 } });

      await expect(
        service.previewTr069ProfileScript('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(zteDriver.generateTr069ProfileScript).not.toHaveBeenCalled();
    });

    it('llama a driver.generateTr069ProfileScript() con los mismos parámetros resueltos que applyTr069Profile, SIN tocar la OLT ni persistir nada', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.generateTr069ProfileScript.mockReturnValue([
        'configure terminal',
        'interface gpon-onu_1/1/1:1',
        'tcont 2 profile SMARTOLT-VOIPMNG-10M',
      ]);

      const preview = await service.previewTr069ProfileScript('onu-uuid-1', { tr069NetworkId: 'tr069-1' });

      expect(zteDriver.generateTr069ProfileScript).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceVlan: 200,
          managementMethod: 'TR069',
          tr069Url: 'http://10.46.0.1:7547/',
          tr069Vlan: 46,
        }),
      );
      expect(preview.commands).toHaveLength(3);
      expect(preview.totalCommands).toBe(3);
      expect(configRepo.save).not.toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el driver no implementa generateTr069ProfileScript (fabricante sin soporte)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      delete (zteDriver as any).generateTr069ProfileScript;

      await expect(
        service.previewTr069ProfileScript('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTr069AcsUrl (acción aislada: solo cambia el ACS, un rechazo de la OLT SIEMPRE es error duro)', () => {
    const mockConfig = {
      onuId: 'onu-uuid-1',
      serviceVlanId: 'vlan-1',
      managementMethod: 'TR069',
      operationMode: 'ROUTER',
      wanMode: 'PPPOE',
      appliedVersion: 1,
      desiredVersion: 1,
    };

    it('lanza BadRequestException si el driver del fabricante no implementa updateTr069AcsUrl (método opcional de IOltDriver)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      delete (zteDriver as any).updateTr069AcsUrl;

      await expect(
        service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
    });

    // BUG REAL corregido (2026-10-25): equipos detectedBy='OLT_IMPORT' (ej.
    // ECOM0EF0CF9B, confirmado en producción) son producción real ya cableada
    // en la OLT por fuera de este sistema -- NO hay que re-autorizarlos. Esta
    // acción puntual nunca toca VLAN/tcont/gemport (confirmado leyendo
    // ZteC320Driver.updateTr069AcsUrl: solo entra a "pon-onu-mng" y corre
    // "tr069-mgmt 1 acs" + reboot), así que bloquearla por falta de una fila
    // de servicio que de todos modos no se usa era un bloqueo innecesario.
    it('sin fila de servicio previa (ej. ONU detectedBy=OLT_IMPORT), crea una mínima en vez de bloquear -- esta acción no necesita VLAN/perfil', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue(null);
      zteDriver.updateTr069AcsUrl.mockResolvedValue({ ok: true });

      const result = await service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }, 'admin-id');

      expect(zteDriver.updateTr069AcsUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tr069Url: 'http://10.46.0.1:7547/' }),
      );
      expect(configRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ onuId: 'onu-uuid-1', managementMethod: 'TR069', operationMode: 'ROUTER' }),
      );
      expect(configRepo.save).toHaveBeenCalledWith(expect.objectContaining({ tr069NetworkId: 'tr069-1' }));
      expect((result as any).tr069Warning).toBeUndefined();
    });

    it('si la OLT rechaza el ACS en una ONU sin fila de servicio previa, NO persiste la fila recién creada (igual que con una fila existente)', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue(null);
      zteDriver.updateTr069AcsUrl.mockResolvedValue({ ok: false, error: 'La OLT rechazó tr069-mgmt 1 acs' });

      await expect(
        service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(configRepo.save).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si no se selecciona Red TR-069', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });

      await expect(service.updateTr069AcsUrl('onu-uuid-1', {} as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException SIN llamar al driver si la Red TR-069 tiene "acsUrl" vacío', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      tr069Repo.findOne.mockResolvedValue({ id: 'tr069-1', vlanId: 46, acsUrl: '', vlan: { vlanId: 46 } });

      await expect(
        service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(zteDriver.updateTr069AcsUrl).not.toHaveBeenCalled();
    });

    it('llama a driver.updateTr069AcsUrl() con los parámetros resueltos y persiste tr069NetworkId', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.updateTr069AcsUrl.mockResolvedValue({ ok: true });

      const result = await service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }, 'admin-id');

      expect(zteDriver.updateTr069AcsUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          tr069Url: 'http://10.46.0.1:7547/',
        }),
      );
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ tr069NetworkId: 'tr069-1' }),
      );
      expect((result as any).tr069Warning).toBeUndefined();
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROVISION', status: 'SUCCESS' }),
      );
    });

    it('lanza BadRequestException si el driver falla (ok:false) -- a diferencia de applyTr069Profile, acá un rechazo de la OLT SIEMPRE es error duro, nunca un warning silencioso', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      zteDriver.updateTr069AcsUrl.mockResolvedValue({ ok: false, error: 'La OLT rechazó tr069-mgmt 1 acs' });

      await expect(
        service.updateTr069AcsUrl('onu-uuid-1', { tr069NetworkId: 'tr069-1' }),
      ).rejects.toThrow(BadRequestException);
      expect(configRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('batchUpdateTr069AcsUrl (migración masiva de ACS en lote)', () => {
    const mockOnu1: any = {
      id: 'onu-1',
      serialNumber: 'ZTEG11111111',
      status: 'ACTIVE',
      onuIndex: 1,
      oltId: 'olt-1',
      olt: { id: 'olt-1', name: 'OLT Central', vendor: 'ZTE' },
      ponInterface: { id: 'pon-1', name: 'gpon-olt_1/1/1' },
      serviceConfig: { onuId: 'onu-1', managementMethod: 'TR069', operationMode: 'ROUTER' },
    };
    const mockOnu2: any = {
      id: 'onu-2',
      serialNumber: 'ZTEG22222222',
      status: 'ACTIVE',
      onuIndex: 2,
      oltId: 'olt-1',
      olt: { id: 'olt-1', name: 'OLT Central', vendor: 'ZTE' },
      ponInterface: { id: 'pon-1', name: 'gpon-olt_1/1/1' },
      serviceConfig: { onuId: 'onu-2', managementMethod: 'TR069', operationMode: 'ROUTER' },
    };

    it('ejecuta con éxito la migración por lote usando driver.batchUpdateTr069AcsUrl', async () => {
      onuRepo.find.mockResolvedValue([mockOnu1, mockOnu2]);
      tr069Repo.findOne.mockResolvedValue({
        id: 'tr069-1',
        name: 'GenieACS Red',
        acsUrl: 'http://10.69.69.1:14501',
        acsUsername: 'soltcpe',
        acsPasswordEnc: encryptCredential('FiEpcY4srQj6'),
        vlanId: 'vlan-46',
      });
      zteDriver.batchUpdateTr069AcsUrl.mockResolvedValue({
        ok: true,
        total: 2,
        successful: 2,
        failed: 0,
        results: [
          { onuId: 'onu-1', serialNumber: 'ZTEG11111111', onuInterface: 'gpon-onu_1/1/1:1', ok: true },
          { onuId: 'onu-2', serialNumber: 'ZTEG22222222', onuInterface: 'gpon-onu_1/1/1:2', ok: true },
        ],
      });

      const result = await service.batchUpdateTr069AcsUrl({
        onuIds: ['onu-1', 'onu-2'],
        tr069NetworkId: 'tr069-1',
      });

      expect(result.ok).toBe(true);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(zteDriver.batchUpdateTr069AcsUrl).toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalledTimes(2);
      expect(deviceOperationLogger.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'PROVISION', status: 'SUCCESS' }),
      );
    });

    it('soporta configuración manual con customAcs sin requerir tr069NetworkId', async () => {
      onuRepo.find.mockResolvedValue([mockOnu1]);
      zteDriver.batchUpdateTr069AcsUrl.mockResolvedValue({
        ok: true,
        total: 1,
        successful: 1,
        failed: 0,
        results: [{ onuId: 'onu-1', serialNumber: 'ZTEG11111111', onuInterface: 'gpon-onu_1/1/1:1', ok: true }],
      });

      const result = await service.batchUpdateTr069AcsUrl({
        onuIds: ['onu-1'],
        customAcs: {
          acsUrl: 'http://10.69.69.1:14501',
          tr069AcsUsername: 'soltcpe',
          tr069AcsPassword: 'FiEpcY4srQj6',
        },
      });

      expect(result.ok).toBe(true);
      expect(result.successful).toBe(1);
      expect(zteDriver.batchUpdateTr069AcsUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            tr069Url: 'http://10.69.69.1:14501',
            tr069AcsUsername: 'soltcpe',
            tr069AcsPassword: 'FiEpcY4srQj6',
          }),
        ]),
      );
    });

    it('reporta fallo por ONU individual si la OLT rechaza una de ellas', async () => {
      onuRepo.find.mockResolvedValue([mockOnu1, mockOnu2]);
      zteDriver.batchUpdateTr069AcsUrl.mockResolvedValue({
        ok: false,
        total: 2,
        successful: 1,
        failed: 1,
        results: [
          { onuId: 'onu-1', serialNumber: 'ZTEG11111111', onuInterface: 'gpon-onu_1/1/1:1', ok: true },
          { onuId: 'onu-2', serialNumber: 'ZTEG22222222', onuInterface: 'gpon-onu_1/1/1:2', ok: false, error: 'Rechazado' },
        ],
      });

      const result = await service.batchUpdateTr069AcsUrl({
        onuIds: ['onu-1', 'onu-2'],
        customAcs: { acsUrl: 'http://10.69.69.1:14501' },
      });

      expect(result.ok).toBe(false);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(configRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('pushWanConfig delegates WAN ownership and state to its orchestrator', () => {
    it('passes method, desired version and actor; returns the operation without claiming a queued task was applied', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      wanProvisioning.configure.mockResolvedValue({ id: 'op-1', status: 'QUEUED', lastError: null });
      const dto = { provisioningMethod: 'TR069' as const, expectedVersion: 2, wanMode: 'PPPOE' as const };
      const result = await service.pushWanConfig('onu-uuid-1', dto, 'actor-1');
      expect(wanProvisioning.configure).toHaveBeenCalledWith(expect.objectContaining({ id: mockOnu.id }), dto, 'actor-1');
      expect(result).toMatchObject({ operationId: 'op-1', cpeConfigured: false });
      expect(result.cpeConfigWarning).toContain('falta confirmar');
    });

    it('propagates a rejected compatibility check without sending a legacy CPE template', async () => {
      onuRepo.findOne.mockResolvedValue(mockOnu);
      wanProvisioning.configure.mockRejectedValue(new BadRequestException('OMCI no validado'));
      await expect(service.pushWanConfig('onu-uuid-1', { provisioningMethod: 'OMCI' })).rejects.toThrow('OMCI no validado');
      expect(cpeConfiguratorService.configureCpe).not.toHaveBeenCalled();
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

      expect(wanProvisioning.configure).toHaveBeenCalledWith(expect.objectContaining({ serialNumber: mockOnu.serialNumber }), expect.objectContaining({ provisioningMethod: 'TR069' }), 'admin-id');
      expect((result as any).cpeConfigured).toBe(true);
    });

    it('si el push a GenieACS falla, no revierte la configuración guardada y marca cpeConfigured:false con advertencia', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, status: 'ACTIVE', contractId: 'contract-1', onuTypeId: 'type-1' });
      configRepo.findOneBy.mockResolvedValue({ ...mockConfig });
      wanProvisioning.configure.mockResolvedValue({ id: 'op-1', status: 'UNKNOWN', lastError: 'GenieACS no confirmó la configuración' });

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

    // BUG REAL corregido (2026-10-25): onu.genieacsDeviceId (columna propia de
    // net.onus) nunca se escribe en ningún lugar del backend -- el vínculo
    // real vive en net.genieacs_devices por contractId. Confirmado en vivo
    // contra un ONU real (CMDCDD4D131E) que GenieACS reportaba ONLINE pero la
    // Ficha 360 mostraba "CPE SIN CONECTAR" por leer la columna muerta.
    it('resuelve genieacsDeviceId desde GenieAcsDeviceResolverService cuando la ONU tiene contrato vinculado', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, contract: { id: 'contract-1' } });
      genieAcsDeviceResolver.findByContractId.mockResolvedValue({
        contractId: 'contract-1',
        genieacsDeviceId: '987DDD-HG8546M%2DXPON-CMDCDD4D131E',
      });

      const result = await service.findById('onu-uuid-1');

      expect(genieAcsDeviceResolver.findByContractId).toHaveBeenCalledWith('contract-1');
      expect(result.genieacsDeviceId).toBe('987DDD-HG8546M%2DXPON-CMDCDD4D131E');
    });

    it('sin contrato vinculado, resuelve directamente por serialNumber en GenieACS', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, contract: null, serialNumber: 'CMDCDD4D131E' });
      genieAcsDeviceResolver.resolveBySerialNumber.mockResolvedValue('987DDD-HG8546M%2DXPON-CMDCDD4D131E');

      const result = await service.findById('onu-uuid-1');

      expect(genieAcsDeviceResolver.findByContractId).not.toHaveBeenCalled();
      expect(genieAcsDeviceResolver.resolveBySerialNumber).toHaveBeenCalledWith('CMDCDD4D131E');
      expect(result.genieacsDeviceId).toBe('987DDD-HG8546M%2DXPON-CMDCDD4D131E');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', { genieacsDeviceId: '987DDD-HG8546M%2DXPON-CMDCDD4D131E' });
    });

    it('sin contrato vinculado y sin coincidencia en GenieACS, deja genieacsDeviceId undefined', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, contract: null, serialNumber: 'CMDCDD4D131E' });
      genieAcsDeviceResolver.resolveBySerialNumber.mockResolvedValue(null);

      const result = await service.findById('onu-uuid-1');

      expect(genieAcsDeviceResolver.findByContractId).not.toHaveBeenCalled();
      expect(genieAcsDeviceResolver.resolveBySerialNumber).toHaveBeenCalledWith('CMDCDD4D131E');
      expect(result.genieacsDeviceId).toBeUndefined();
    });

    it('con contrato pero sin dispositivo GenieACS resuelto todavía en contrato, intenta resolver por serial', async () => {
      onuRepo.findOne.mockResolvedValue({ ...mockOnu, contract: { id: 'contract-1' }, serialNumber: 'CMDCDD4D131E' });
      genieAcsDeviceResolver.findByContractId.mockResolvedValue({ contractId: 'contract-1', genieacsDeviceId: null });
      genieAcsDeviceResolver.resolveBySerialNumber.mockResolvedValue('987DDD-HG8546M%2DXPON-CMDCDD4D131E');

      const result = await service.findById('onu-uuid-1');

      expect(genieAcsDeviceResolver.findByContractId).toHaveBeenCalledWith('contract-1');
      expect(genieAcsDeviceResolver.resolveBySerialNumber).toHaveBeenCalledWith('CMDCDD4D131E');
      expect(result.genieacsDeviceId).toBe('987DDD-HG8546M%2DXPON-CMDCDD4D131E');
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
      onuType: { vendorTypeName: 'ZTE-F660' } as any,
      serviceConfig: { serviceVlan: { vlanId: 200 } } as any,
    };

    beforeEach(() => {
      zteDriver.getOnuSlotIdentity = jest.fn().mockResolvedValue('ZTEGC0123456');
    });

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

    it('conserva el origen cuando no se puede demostrar vacío el PON destino', async () => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu }).mockResolvedValueOnce(null).mockResolvedValueOnce(activeOnu);
      ifaceRepo.findOneBy.mockResolvedValue({ id: 'iface-2', name: 'gpon-olt_1/2/3' });
      zteDriver.deleteOnu.mockResolvedValue({ ok: true });
      zteDriver.authorizeOnu.mockResolvedValue({ ok: true });

      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999', newPonInterface: 'gpon-olt_1/2/3' })).rejects.toThrow('origen conservado');
      expect(zteDriver.deleteOnu).not.toHaveBeenCalled();
      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
    });

    it.each([null, 'OTROSERIAL'])('conserva el origen si la identidad física es %s', async (identity) => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu }).mockResolvedValueOnce(null);
      zteDriver.getOnuSlotIdentity.mockResolvedValue(identity);
      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999' })).rejects.toThrow('origen conservado');
      expect(zteDriver.deleteOnu).not.toHaveBeenCalled();
    });

    it.each(['ausente', 'ocupado'])('valida el puerto NAP %s antes de cualquier efecto', async (caso) => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu }).mockResolvedValueOnce(null);
      napPortRepo.findOne.mockResolvedValue(caso === 'ausente' ? null : { status: 'OCUPADO', onuId: 'otro', portNumber: 3 });
      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999', newNapPortId: 'nuevo' })).rejects.toThrow();
      expect(zteDriver.deleteOnu).not.toHaveBeenCalled();
      expect(napPortRepo.update).not.toHaveBeenCalled();
      expect(onuRepo.update).not.toHaveBeenCalled();
    });

    it('rechaza una ubicación origen inconsistente antes de efectos', async () => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu, onuIndex: 'gpon-onu_1/2/3:2' }).mockResolvedValueOnce(null);
      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999' })).rejects.toThrow(BadRequestException);
      expect(zteDriver.deleteOnu).not.toHaveBeenCalled();
    });

    it('aborta sin cambios si falla el borrado', async () => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu }).mockResolvedValueOnce(null);
      zteDriver.deleteOnu.mockResolvedValue({ ok: false, error: 'rechazado' });
      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999' })).rejects.toThrow(BadRequestException);
      expect(zteDriver.authorizeOnu).not.toHaveBeenCalled();
      expect(onuRepo.update).not.toHaveBeenCalled();
    });

    it.each(['rechazo', 'excepción'])('marca ERROR y no informa éxito ante %s de reautorización', async (caso) => {
      onuRepo.findOne.mockResolvedValueOnce({ ...activeOnu }).mockResolvedValueOnce(null);
      zteDriver.deleteOnu.mockResolvedValue({ ok: true });
      if (caso === 'rechazo') zteDriver.authorizeOnu.mockResolvedValue({ ok: false, error: 'rechazado' });
      else zteDriver.authorizeOnu.mockRejectedValue(new Error('sin conexión'));
      await expect(service.migrateOnu('onu-uuid-1', { newSerialNumber: 'ZTEGC9999999', newNapPortId: 'nuevo' })).rejects.toThrow('recuperación manual');
      expect(onuRepo.update).toHaveBeenCalledWith('onu-uuid-1', { status: 'ERROR' });
      expect(napPortRepo.update).not.toHaveBeenCalled();
      expect(napPortRepo.save).not.toHaveBeenCalled();
      expect(deviceOperationLogger.logEvent).not.toHaveBeenCalled();
      expect(cpeConfiguratorService.configureCpe).not.toHaveBeenCalled();
    });
  });
});
