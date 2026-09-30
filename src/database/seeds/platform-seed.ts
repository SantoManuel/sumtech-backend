import * as dotenv from 'dotenv';
dotenv.config();

import * as bcrypt from 'bcrypt';
import { PlatformDataSource } from '../../config/platform-database.config';
import { PlatformUserEntity } from '../../modules/platform/entities/platform-user.entity';
import { PlatformRole } from '../../modules/platform/enums/platform-role.enum';

const SEED_USERS = [
  {
    email: 'superadmin@sumtech.com',
    role: PlatformRole.SUPERADMIN,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'superadmin@sumtech.do',
    role: process.env.PLATFORM_SEED_EMAIL ? PlatformRole.SUPERADMIN : PlatformRole.SUPERADMIN,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'support@sumtech.com',
    role: PlatformRole.SUPPORT,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
  {
    email: 'support@sumtech.do',
    role: PlatformRole.SUPPORT,
    password: process.env.PLATFORM_SEED_PASSWORD || 'password123',
  },
];

export async function runPlatformSeed() {
  console.log('🌱 Sembrando usuarios base de la plataforma SaaS (SuperAdmin y Soporte)...');

  if (!PlatformDataSource.isInitialized) {
    await PlatformDataSource.initialize();
  }

  const platformUserRepo = PlatformDataSource.getRepository(PlatformUserEntity);

  for (const userDef of SEED_USERS) {
    const existing = await platformUserRepo.findOneBy({ email: userDef.email });
    const passwordHash = await bcrypt.hash(userDef.password, 10);

    if (existing) {
      existing.passwordHash = passwordHash;
      existing.isActive = true;
      existing.role = userDef.role;
      await platformUserRepo.save(existing);
      console.log(`ℹ️  Usuario de plataforma actualizado con clave de prueba: ${userDef.email} (${userDef.role})`);
    } else {
      await platformUserRepo.save(
        platformUserRepo.create({
          email: userDef.email,
          passwordHash,
          role: userDef.role,
          isActive: true,
        }),
      );
      console.log(`✅ Usuario de plataforma creado: ${userDef.email} (${userDef.role})`);
    }
  }
}

if (require.main === module) {
  runPlatformSeed()
    .then(() => PlatformDataSource.destroy())
    .catch((err) => {
      console.error('❌ Error ejecutando el seed de plataforma:', err);
      process.exit(1);
    });
}
