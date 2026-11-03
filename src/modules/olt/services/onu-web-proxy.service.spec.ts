import { Test, TestingModule } from '@nestjs/testing';
import { OnuWebProxyService } from './onu-web-proxy.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OnuEntity } from '../entities/onu.entity';
import { OnuServiceConfigEntity } from '../entities/onu-service-config.entity';
import { GENIEACS_CLIENT } from '../../genieacs/genieacs-client-factory';
import { GenieAcsDeviceResolverService } from '../../genieacs/genieacs-device-resolver.service';
import { OnuManagementService } from './onu-management.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('OnuWebProxyService', () => {
  let service: OnuWebProxyService;

  const mockOnuRepository = {
    findOne: jest.fn(),
  };

  const mockConfigRepository = {
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    create: jest.fn((data) => data),
    save: jest.fn(async (data) => data),
  };

  const mockGenieAcsClient = {
    getParameterValues: jest.fn(),
  };

  const mockGenieAcsDeviceResolver = {
    findByContractId: jest.fn(),
  };

  // Por defecto no hay nada resuelto en vivo contra la OLT (ej. Huawei,
  // driver sin implementar) -- así los tests existentes de GenieACS/manual/
  // wanStaticIp conservan su comportamiento sin tener que mockear esto cada vez.
  const mockOnuManagementService = {
    resolveLiveManagementIp: jest.fn().mockResolvedValue(null),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock_jwt_token_123'),
    verify: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('test_jwt_secret'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnuWebProxyService,
        {
          provide: getRepositoryToken(OnuEntity),
          useValue: mockOnuRepository,
        },
        {
          provide: getRepositoryToken(OnuServiceConfigEntity),
          useValue: mockConfigRepository,
        },
        {
          provide: GENIEACS_CLIENT,
          useValue: mockGenieAcsClient,
        },
        {
          provide: GenieAcsDeviceResolverService,
          useValue: mockGenieAcsDeviceResolver,
        },
        {
          provide: OnuManagementService,
          useValue: mockOnuManagementService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<OnuWebProxyService>(OnuWebProxyService);
  });

  it('debe sugerir credenciales telecomadmin/admintelecom para ONUs Huawei y seriales CMDC/HWTC', () => {
    const credsHuawei = service.getSuggestedCredentials('Huawei', 'HG8546M', 'CMDCDD4D131E');
    expect(credsHuawei.username).toBe('telecomadmin');
    expect(credsHuawei.password).toBe('admintelecom');
    expect(credsHuawei.altUsername).toBe('root');

    const credsZte = service.getSuggestedCredentials('ZTE', 'F660', 'ZTEG12345678');
    expect(credsZte.username).toBe('admin');
    expect(credsZte.password).toBe('admin');
  });

  it('resuelve la IP consultando EN VIVO a la OLT (getOnuIpHost/getOnuWanIp vía OnuManagementService) antes que cualquier otra fuente -- esto es lo que permite entrar sin depender de GenieACS', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'ZTEG12345678',
      genieacsDeviceId: 'zte-device-1',
      serviceConfig: { tr069Ip: '10.50.0.10' },
    } as any;

    mockOnuManagementService.resolveLiveManagementIp.mockResolvedValueOnce('172.20.1.5');

    const ip = await service.resolveOnuIp(mockOnu);

    expect(mockOnuManagementService.resolveLiveManagementIp).toHaveBeenCalledWith('onu-1');
    expect(ip).toBe('172.20.1.5');
    expect(mockGenieAcsClient.getParameterValues).not.toHaveBeenCalled();
  });

  it('si la OLT no soporta/no reporta IP en vivo (ej. driver Huawei sin implementar), cae a serviceConfig.tr069Ip', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      serviceConfig: { tr069Ip: '10.50.0.10' },
    } as any;

    mockOnuManagementService.resolveLiveManagementIp.mockResolvedValueOnce(null);

    const ip = await service.resolveOnuIp(mockOnu);
    expect(ip).toBe('10.50.0.10');
  });

  it('resuelve la IP de gestión desde GenieACS ConnectionRequestURL si existe', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      genieacsDeviceId: '987DDD-HG8546M%2DXPON-CMDCDD4D131E',
    } as any;

    mockGenieAcsClient.getParameterValues.mockResolvedValue({
      'InternetGatewayDevice.ManagementServer.ConnectionRequestURL': 'http://10.46.0.250:58000/',
    });

    const ip = await service.resolveOnuIp(mockOnu);
    expect(ip).toBe('10.46.0.250');
  });

  it('resuelve la IP desde serviceConfig.tr069Ip si GenieACS no tiene ConnectionRequestURL', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      serviceConfig: { tr069Ip: '10.50.0.10' },
    } as any;

    const ip = await service.resolveOnuIp(mockOnu);
    expect(ip).toBe('10.50.0.10');
  });

  it('la IP manual (serviceConfig.tr069Ip) tiene prioridad sobre un ConnectionRequestURL válido de GenieACS', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      genieacsDeviceId: '987DDD-HG8546M%2DXPON-CMDCDD4D131E',
      serviceConfig: { tr069Ip: '10.50.0.10' },
    } as any;

    mockGenieAcsClient.getParameterValues.mockResolvedValue({
      'InternetGatewayDevice.ManagementServer.ConnectionRequestURL': 'http://10.46.0.250:58000/',
    });

    const ip = await service.resolveOnuIp(mockOnu);
    expect(ip).toBe('10.50.0.10');
    expect(mockGenieAcsClient.getParameterValues).not.toHaveBeenCalled();
  });

  it('lanza BadRequestException si no se puede determinar la IP de la ONU', async () => {
    const mockOnu = {
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
    } as any;

    await expect(service.resolveOnuIp(mockOnu)).rejects.toThrow(BadRequestException);
  });

  it('crea sesión con token y launchUrl para ONU encontrada', async () => {
    mockOnuRepository.findOne.mockResolvedValue({
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      vendor: 'Huawei',
      model: 'HG8546M',
      serviceConfig: { tr069Ip: '10.46.0.250' },
    });

    jest.spyOn(service, 'checkPortConnectivity').mockResolvedValue(true);

    const session = await service.createWebSession('onu-1', 'user-123');

    expect(session.success).toBe(true);
    expect(session.targetIp).toBe('10.46.0.250');
    expect(session.port).toBe(80);
    expect(session.token).toBe('mock_jwt_token_123');
    expect(session.launchUrl).toContain('/api/v1/olt/onus/web-proxy/launch?token=');
    expect(session.credentials.username).toBe('telecomadmin');
  });

  it('persiste manualIp en serviceConfig.tr069Ip y la usa de inmediato, sin depender de GenieACS (ONU CMDC sin contacto TR-069)', async () => {
    mockOnuRepository.findOne.mockResolvedValue({
      id: 'onu-1',
      serialNumber: 'CMDCDD4D131E',
      vendor: 'Huawei',
      model: 'HG8546M',
      serviceConfig: undefined,
    });

    jest.spyOn(service, 'checkPortConnectivity').mockResolvedValue(true);

    const session = await service.createWebSession('onu-1', 'user-123', '192.168.100.50');

    expect(mockConfigRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ onuId: 'onu-1' }),
    );
    expect(mockConfigRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ tr069Ip: '192.168.100.50' }),
    );
    expect(session.targetIp).toBe('192.168.100.50');
    expect(mockGenieAcsClient.getParameterValues).not.toHaveBeenCalled();
  });

  it('manualIp reutiliza la fila de serviceConfig existente en vez de crear una nueva', async () => {
    mockOnuRepository.findOne.mockResolvedValue({
      id: 'onu-1',
      serialNumber: 'ZTEG12345678',
      serviceConfig: { id: 'cfg-1', onuId: 'onu-1', wanStaticIp: '10.0.0.5' },
    });

    jest.spyOn(service, 'checkPortConnectivity').mockResolvedValue(true);

    const session = await service.createWebSession('onu-1', 'user-123', '172.16.0.20');

    expect(mockConfigRepository.create).not.toHaveBeenCalled();
    expect(mockConfigRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cfg-1', tr069Ip: '172.16.0.20' }),
    );
    expect(session.targetIp).toBe('172.16.0.20');
  });

  it('lanza NotFoundException si la ONU no existe', async () => {
    mockOnuRepository.findOne.mockResolvedValue(null);

    await expect(service.createWebSession('onu-inexistente', 'user-123')).rejects.toThrow(NotFoundException);
  });
});
