import { UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TenantContextService } from '../../common/tenancy/tenant-context.service';
import { TenantIteratorService } from '../../common/tenancy/tenant-iterator.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

const CONFIG_VALUES: Record<string, string> = {
  JWT_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  JWT_EXPIRATION_TIME: '15m',
  JWT_REFRESH_EXPIRATION_TIME: '7d',
};

function buildActiveUser(overrides: Partial<any> = {}) {
  return {
    id: 'user-1',
    username: 'admin',
    email: 'admin@sumtech.com',
    passwordHash: 'hashed-password',
    isActive: true,
    roles: [{ name: 'ADMIN' }],
    employee: undefined,
    client: undefined,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<Pick<UsersService, 'findByUsernameOrEmail' | 'findById'>>;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign' | 'verify'>>;
  let configService: ConfigService;
  let refreshTokenRepository: any;
  let tenantContext: jest.Mocked<Pick<TenantContextService, 'getTenantId' | 'getSlug'>>;
  let tenantIterator: jest.Mocked<Pick<TenantIteratorService, 'runForEachActiveTenant'>>;

  beforeEach(() => {
    jest.clearAllMocks();

    usersService = {
      findByUsernameOrEmail: jest.fn(),
      findById: jest.fn(),
    };

    let signCallCount = 0;
    jwtService = {
      sign: jest.fn((_payload: any, _options?: any) => `signed-token-${++signCallCount}`),
      verify: jest.fn(),
    };

    configService = { get: (key: string) => CONFIG_VALUES[key] } as unknown as ConfigService;

    refreshTokenRepository = {
      create: jest.fn((data: any) => data),
      save: jest.fn((entity: any) => Promise.resolve({ id: 'rt-id', ...entity })),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    tenantContext = {
      getTenantId: jest.fn().mockReturnValue('tenant-test-id'),
      getSlug: jest.fn().mockReturnValue('tenant-test'),
    };

    tenantIterator = {
      // Simula un solo tenant activo ('tenant-test') e invoca el callback de
      // verdad, para que los specs que dependen del efecto interno (ej.
      // cleanupExpiredRefreshTokens) sigan probando el mismo comportamiento
      // real que antes de envolverlo en runForEachActiveTenant().
      runForEachActiveTenant: jest.fn(async (_label: string, fn: (tenant: any) => Promise<void>) => {
        await fn({ id: 'tenant-test-id', slug: 'tenant-test' });
      }),
    };

    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService,
      refreshTokenRepository,
      tenantContext as unknown as TenantContextService,
      tenantIterator as unknown as TenantIteratorService,
    );
  });

  describe('login', () => {
    it('emite access token + refresh token y persiste el hash del refresh con un familyId nuevo', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(buildActiveUser() as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ identifier: 'admin', password: 'password123' } as any);

      expect(result.accessToken).toBeDefined();
      expect((result as any).refreshTokenRaw).toBeDefined();
      expect(result.user.id).toBe('user-1');

      expect(refreshTokenRepository.save).toHaveBeenCalledTimes(1);
      const savedRow = refreshTokenRepository.save.mock.calls[0][0];
      expect(savedRow.userId).toBe('user-1');
      expect(savedRow.tokenHash).toHaveLength(64); // sha256 hex
      expect(savedRow.familyId).toBeDefined();
      expect(savedRow.revokedAt).toBeUndefined();
    });

    it('rechaza credenciales inválidas (usuario no existe)', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(null);

      await expect(
        service.login({ identifier: 'no-existe', password: 'password123' } as any),
      ).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it('rechaza si el usuario existe pero está inactivo', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(buildActiveUser({ isActive: false }) as any);

      await expect(
        service.login({ identifier: 'admin', password: 'password123' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza si la contraseña no coincide', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(buildActiveUser() as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ identifier: 'admin', password: 'incorrecta' } as any),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('lanza BadRequestException si no se provee identifier ni username', async () => {
      await expect(service.login({ password: 'password123' } as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('refreshToken', () => {
    it('rota el token: revoca el actual, crea uno nuevo con el mismo familyId', async () => {
      const familyId = 'family-abc';
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', familyId } as any);
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId,
        tokenHash: 'hash-viejo',
        revokedAt: null,
      });
      usersService.findById.mockResolvedValue(buildActiveUser() as any);

      const result = await service.refreshToken('raw-refresh-token');

      expect(result.accessToken).toBeDefined();
      expect((result as any).refreshTokenRaw).toBeDefined();

      // El registro viejo se marca revocado y se le asigna replacedByTokenHash
      expect(refreshTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'rt-1', revokedAt: expect.any(Date), replacedByTokenHash: expect.any(String) }),
      );

      // El nuevo token persistido comparte el mismo familyId
      const newRowSaved = refreshTokenRepository.save.mock.calls.find(
        (call: any[]) => call[0].familyId === familyId && call[0].id !== 'rt-1',
      );
      expect(newRowSaved).toBeDefined();
    });

    it('detecta reuso (token ya revocado) y revoca TODA la familia', async () => {
      const familyId = 'family-robada';
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', familyId } as any);
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId,
        tokenHash: 'hash-ya-usado',
        revokedAt: new Date('2026-01-01T00:00:00Z'),
      });

      await expect(service.refreshToken('raw-refresh-token-reusado')).rejects.toThrow(UnauthorizedException);

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { familyId },
        { revokedAt: expect.any(Date) },
      );
      // No debe emitir tokens nuevos en el camino de reuso
      expect(refreshTokenRepository.save).not.toHaveBeenCalled();
    });

    it('rechaza un JWT con firma inválida o expirado', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshToken('token-malformado')).rejects.toThrow(UnauthorizedException);
      expect(refreshTokenRepository.findOne).not.toHaveBeenCalled();
    });

    it('rechaza si el token no existe en la base de datos (nunca fue emitido por nosotros)', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', familyId: 'f1' } as any);
      refreshTokenRepository.findOne.mockResolvedValue(null);

      await expect(service.refreshToken('token-desconocido')).rejects.toThrow(UnauthorizedException);
    });

    it('rechaza si el usuario fue desactivado entre el login y el refresh', async () => {
      jwtService.verify.mockReturnValue({ sub: 'user-1', jti: 'jti-1', familyId: 'f1' } as any);
      refreshTokenRepository.findOne.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        familyId: 'f1',
        tokenHash: 'hash',
        revokedAt: null,
      });
      usersService.findById.mockResolvedValue(buildActiveUser({ isActive: false }) as any);

      await expect(service.refreshToken('raw-token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revoca el refresh token correspondiente', async () => {
      await service.logout('raw-refresh-token');

      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { tokenHash: expect.any(String) },
        { revokedAt: expect.any(Date) },
      );
    });

    it('es idempotente: no lanza si no se provee ningún token', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokenRepository.update).not.toHaveBeenCalled();
    });

    it('es idempotente: no lanza aunque el token no exista en la base de datos', async () => {
      refreshTokenRepository.update.mockResolvedValue({ affected: 0 });

      await expect(service.logout('token-que-no-existe')).resolves.toBeUndefined();
    });
  });

  describe('cleanupExpiredRefreshTokens', () => {
    it('elimina solo las filas expiradas hace más de 30 días', async () => {
      refreshTokenRepository.delete.mockResolvedValue({ affected: 3 });

      await service.cleanupExpiredRefreshTokens();

      expect(refreshTokenRepository.delete).toHaveBeenCalledWith({
        expiresAt: expect.objectContaining({ _type: 'lessThan' }),
      });
    });
  });

  describe('verifySupervisorCredentials', () => {
    it('lanza BadRequestException si falta el identificador o la contraseña', async () => {
      await expect(service.verifySupervisorCredentials('', 'secret')).rejects.toThrow(BadRequestException);
      await expect(service.verifySupervisorCredentials('admin', '')).rejects.toThrow(BadRequestException);
    });

    it('lanza UnauthorizedException si el usuario no existe', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(null);

      await expect(service.verifySupervisorCredentials('desconocido', 'secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si el usuario está inactivo', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(buildActiveUser({ isActive: false }));

      await expect(service.verifySupervisorCredentials('admin', 'secret')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza UnauthorizedException si la contraseña no coincide', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(buildActiveUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.verifySupervisorCredentials('admin', 'wrong-pass')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('lanza ForbiddenException si el usuario no tiene rol ADMIN ni GERENTE', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(
        buildActiveUser({ roles: [{ name: 'CAJERO' }] }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(service.verifySupervisorCredentials('cajero1', 'valid-pass')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('autentica exitosamente a un supervisor con rol ADMIN', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(
        buildActiveUser({
          id: 'sup-1',
          username: 'admin_general',
          email: 'admin@sumtech.com',
          roles: [{ name: 'ADMIN' }],
          employee: { firstName: 'Juan', lastName: 'Perez' },
        }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.verifySupervisorCredentials('admin_general', 'valid-pass');

      expect(result).toEqual({
        id: 'sup-1',
        username: 'admin_general',
        email: 'admin@sumtech.com',
      });
    });

    it('autentica exitosamente a un supervisor con rol GERENTE', async () => {
      usersService.findByUsernameOrEmail.mockResolvedValue(
        buildActiveUser({
          id: 'sup-2',
          username: 'gerente_sucursal',
          email: 'gerente@sumtech.com',
          roles: [{ name: 'GERENTE' }],
        }),
      );
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.verifySupervisorCredentials('gerente_sucursal', 'valid-pass');

      expect(result).toEqual({
        id: 'sup-2',
        username: 'gerente_sucursal',
        email: 'gerente@sumtech.com',
      });
    });
  });
});
