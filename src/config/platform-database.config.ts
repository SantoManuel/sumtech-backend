import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSource, DataSourceOptions } from 'typeorm';

import { TenantEntity } from '../modules/platform/entities/tenant.entity';
import { SaasPlanEntity } from '../modules/platform/entities/saas-plan.entity';
import { SaasSubscriptionEntity } from '../modules/platform/entities/saas-subscription.entity';
import { PlatformUserEntity } from '../modules/platform/entities/platform-user.entity';
import { SupportAccessSessionEntity } from '../modules/platform/entities/support-access-session.entity';
import { PlatformAuditLogEntity } from '../modules/platform/entities/platform-audit-log.entity';
import { TenantTunnelAllocationEntity } from '../modules/platform/entities/tenant-tunnel-allocation.entity';

// Entidades de la DB de plataforma (sumtech_platform) — completamente separada
// de las entidades de tenant en database.config.ts. Nunca deben mezclarse.
export const platformEntities = [
  TenantEntity,
  SaasPlanEntity,
  SaasSubscriptionEntity,
  PlatformUserEntity,
  SupportAccessSessionEntity,
  PlatformAuditLogEntity,
  TenantTunnelAllocationEntity,
];

// Reutiliza el mismo servidor Postgres (DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD)
// que la conexión de tenant por defecto — solo el nombre de la base de datos
// cambia (PLATFORM_DB_DATABASE), ya que es un servidor Postgres compartido.
export const platformDatabaseConfig = registerAs(
  'platformDatabase',
  (): TypeOrmModuleOptions => ({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.PLATFORM_DB_DATABASE || 'sumtech_platform',
    entities: platformEntities,
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  }),
);

const platformDataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.PLATFORM_DB_DATABASE || 'sumtech_platform',
  entities: platformEntities,
  synchronize: false,
};

// Usado por el runner standalone de migraciones de plataforma
// (apply-platform-migrations.ts) y por el seed del primer SUPERADMIN — igual
// que AppDataSource en database.config.ts, requiere pasar DB_* inline si se
// invoca fuera del boot completo de Nest (no carga .env por sí solo).
export const PlatformDataSource = new DataSource(platformDataSourceOptions);
