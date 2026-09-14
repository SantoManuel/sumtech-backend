import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { UserEntity } from './entities/user.entity';
import { RoleEntity } from './entities/role.entity';
import { AuditLogEntity } from './entities/audit-log.entity';

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: any;
  let queryBuilder: any;

  beforeEach(async () => {
    queryBuilder = {
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    userRepo = {
      createQueryBuilder: jest.fn(() => queryBuilder),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(RoleEntity), useValue: {} },
        { provide: getRepositoryToken(AuditLogEntity), useValue: {} },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('verifyPassword', () => {
    it('devuelve true si la contraseña en texto plano coincide con el hash guardado', async () => {
      const passwordHash = await bcrypt.hash('MiClaveSegura2026!', 10);
      queryBuilder.getOne.mockResolvedValue({ id: 'user-1', passwordHash });

      const result = await service.verifyPassword('user-1', 'MiClaveSegura2026!');

      expect(result).toBe(true);
      expect(queryBuilder.addSelect).toHaveBeenCalledWith('user.passwordHash');
    });

    it('devuelve false si la contraseña no coincide', async () => {
      const passwordHash = await bcrypt.hash('MiClaveSegura2026!', 10);
      queryBuilder.getOne.mockResolvedValue({ id: 'user-1', passwordHash });

      const result = await service.verifyPassword('user-1', 'clave-incorrecta');

      expect(result).toBe(false);
    });

    it('devuelve false (no lanza) si el usuario no existe', async () => {
      queryBuilder.getOne.mockResolvedValue(null);

      const result = await service.verifyPassword('user-inexistente', 'cualquier-cosa');

      expect(result).toBe(false);
    });
  });
});
