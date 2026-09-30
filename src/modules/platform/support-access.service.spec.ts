import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { SupportAccessService } from './support-access.service';
import { SupportAccessSessionEntity } from './entities/support-access-session.entity';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformRole } from './enums/platform-role.enum';

describe('SupportAccessService', () => {
  let service: SupportAccessService;
  let sessionRepo: any;
  let tenantRepo: any;
  let jwtService: any;
  let auditService: any;

  const mockAdmin = {
    sub: 'admin-uuid-1',
    email: 'superadmin@sumtech.com',
    role: PlatformRole.SUPERADMIN,
    scope: 'platform' as const,
  };

  const mockTenant: Partial<TenantEntity> = {
    id: 'tenant-uuid-1',
    name: 'ISP TeleAzua',
    slug: 'teleazua',
    status: TenantStatus.ACTIVE,
  };

  const mockSession: Partial<SupportAccessSessionEntity> = {
    id: 'session-uuid-1',
    adminId: 'admin-uuid-1',
    tenantId: 'tenant-uuid-1',
    reason: 'Investigación de error en facturación DGII',
    startedAt: new Date(),
    tenant: mockTenant as any,
  };

  beforeEach(async () => {
    sessionRepo = {
      create: jest.fn().mockImplementation((s) => ({ ...s, id: 'session-uuid-1' })),
      save: jest.fn().mockImplementation((s) => Promise.resolve(s)),
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'session-uuid-1') return Promise.resolve({ ...mockSession });
        return Promise.resolve(null);
      }),
      find: jest.fn().mockResolvedValue([mockSession]),
    };

    tenantRepo = {
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 'tenant-uuid-1') return Promise.resolve({ ...mockTenant });
        return Promise.resolve(null);
      }),
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mock-scoped-jwt-token'),
    };

    auditService = {
      log: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportAccessService,
        { provide: getRepositoryToken(SupportAccessSessionEntity, 'platform'), useValue: sessionRepo },
        { provide: getRepositoryToken(TenantEntity, 'platform'), useValue: tenantRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test-secret') } },
        { provide: PlatformAuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<SupportAccessService>(SupportAccessService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startSession', () => {
    it('creates an audited support session and issues a scoped token', async () => {
      const result = await service.startSession(
        {
          tenantId: 'tenant-uuid-1',
          reason: 'Investigación de error en facturación DGII',
        },
        mockAdmin,
        '192.168.1.1',
      );

      expect(result.session).toBeDefined();
      expect(result.accessToken).toBe('mock-scoped-jwt-token');
      expect(result.tenant.slug).toBe('teleazua');
      expect(result.erpUrl).toBe('http://teleazua.localhost:3000/dashboard');

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'admin-uuid-1',
          isSupportSession: true,
          supportSessionId: 'session-uuid-1',
          tenantSlug: 'teleazua',
        }),
        expect.any(Object),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUPPORT_SESSION_STARTED',
          entity: 'SupportAccessSession',
        }),
      );
    });

    it('throws NotFoundException if tenant does not exist', async () => {
      await expect(
        service.startSession(
          { tenantId: 'invalid-id', reason: 'Motivo válido de prueba' },
          mockAdmin,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if tenant is CANCELLED', async () => {
      tenantRepo.findOne.mockResolvedValueOnce({ ...mockTenant, status: TenantStatus.CANCELLED });
      await expect(
        service.startSession(
          { tenantId: 'tenant-uuid-1', reason: 'Motivo válido de prueba' },
          mockAdmin,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('endSession', () => {
    it('seals the session with endedAt and logs audit', async () => {
      const result = await service.endSession('session-uuid-1', 'admin-uuid-1');
      expect(result.session.endedAt).toBeDefined();
      expect(sessionRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'SUPPORT_SESSION_ENDED',
          entity: 'SupportAccessSession',
          entityId: 'session-uuid-1',
        }),
      );
    });

    it('throws NotFoundException if session does not exist', async () => {
      await expect(service.endSession('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});
