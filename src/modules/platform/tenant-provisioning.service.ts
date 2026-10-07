import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { TenantEntity } from './entities/tenant.entity';
import { TenantStatus } from './enums/tenant-status.enum';
import { SaasSubscriptionEntity } from './entities/saas-subscription.entity';
import { SaasSubscriptionStatus } from './enums/saas-subscription-status.enum';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { entities as tenantEntities } from '../../config/database.config';
import { runGeographySeed } from '../../database/seeds/geography-seed';
import { runTenantBootstrapSeed } from '../../database/seeds/tenant-bootstrap-seed';
import { MailService } from '../mail/mail.service';
import { getJwtSecret } from '../../common/utils/required-env.util';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// Subdominios que nunca pueden ser el slug de un tenant real — namespace
// reservado de la plataforma (admin.*, www.*, etc.) más algunos genéricos de
// buena práctica. Los slugs son subdominios (Host), no rutas de la API, así
// que no chocan con prefijos de endpoints existentes (/clients, /pos, etc.).
const RESERVED_SLUGS = new Set(['api', 'admin', 'www', 'app', 'platform', 'mail', 'ftp', 'localhost']);

export interface ProvisionTenantResult {
  tenantId: string;
  slug: string;
  status: TenantStatus;
  accessToken: string;
}

/**
 * Aprovisiona un tenant nuevo de punta a punta: valida el slug, crea su base
 * de datos Postgres real, la sincroniza desde los decoradores de entidades
 * (NO reutiliza el replay de los 53 archivos .sql de apply-migrations.ts —
 * varios son backfills de datos específicos del entorno original de Sumtech,
 * no DDL genérico; ese camino se reserva para la Fase 8, evolucionar tenants
 * YA aprovisionados), siembra geografía + roles base + el primer TenantAdmin,
 * y registra el tenant en la DB de plataforma. Usado tanto por el registro
 * público (landing, Fase 7) como por el alta manual del SuperAdmin (Fase 6).
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger = new Logger(TenantProvisioningService.name);

  constructor(
    @InjectRepository(TenantEntity, 'platform')
    private readonly tenantRepository: Repository<TenantEntity>,
    @InjectRepository(SaasSubscriptionEntity, 'platform')
    private readonly subscriptionRepository: Repository<SaasSubscriptionEntity>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
  ) {}

  async provision(input: RegisterTenantDto): Promise<ProvisionTenantResult> {
    const slug = input.slug.toLowerCase();

    if (RESERVED_SLUGS.has(slug)) {
      throw new BadRequestException(`El identificador "${slug}" está reservado y no puede usarse.`);
    }

    const existing = await this.tenantRepository.findOne({ where: { slug } });
    if (existing) {
      throw new ConflictException(`Ya existe un tenant con el identificador "${slug}".`);
    }

    const dbName = `tenant_${slug.replace(/-/g, '_')}`;
    const existingDbName = await this.tenantRepository.findOne({ where: { dbName } });
    if (existingDbName) {
      throw new ConflictException(`Ya existe un tenant apuntando a la base de datos "${dbName}".`);
    }

    await this.createDatabase(dbName);

    let tenantDataSource: DataSource | undefined;
    try {
      tenantDataSource = await this.buildAndSyncTenantDataSource(dbName);

      await runGeographySeed(tenantDataSource);

      const adminPasswordHash = await bcrypt.hash(input.adminPassword, 10);
      const adminUsername = this.deriveUsername(input.adminEmail);
      const adminUser = await runTenantBootstrapSeed(tenantDataSource, {
        adminUsername,
        adminEmail: input.adminEmail,
        adminPasswordHash,
        adminName: input.adminName,
        companyName: input.name,
        rnc: input.rnc,
      });

      const tenant = await this.tenantRepository.save(
        this.tenantRepository.create({
          name: input.name,
          rnc: input.rnc,
          slug,
          dbName,
          status: TenantStatus.TRIAL,
          planId: input.planId,
        }),
      );

      // Crear automáticamente la suscripción inicial en estado TRIALING (14 días de prueba)
      if (input.planId) {
        const trialDays = 14;
        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + trialDays);

        await this.subscriptionRepository.save(
          this.subscriptionRepository.create({
            tenantId: tenant.id,
            planId: input.planId,
            status: SaasSubscriptionStatus.TRIALING,
            currentPeriodEnd: periodEnd,
            trialEndsAt: periodEnd,
            billingNotes: 'Suscripción inicial creada durante el registro del tenant.',
          }),
        );
      }

      await this.mailService.sendTemplatedMail({
        to: input.adminEmail,
        subject: `Bienvenido a Sumtech, ${input.name}`,
        template: 'welcome-tenant',
        context: {
          tenantName: input.name,
          adminName: input.adminName,
          slug,
          loginUrl: `https://${slug}.app.sumtech.com`,
        },
      });

      const payload: JwtPayload = {
        sub: adminUser.id,
        username: adminUser.username,
        email: adminUser.email,
        roles: ['ADMIN'],
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
      };
      const accessToken = this.jwtService.sign(payload, {
        secret: getJwtSecret(this.configService),
        expiresIn: this.configService.get<string>('JWT_EXPIRATION_TIME') || '15m',
      });

      await tenantDataSource.destroy();

      return { tenantId: tenant.id, slug: tenant.slug, status: tenant.status, accessToken };
    } catch (err) {
      this.logger.error(
        `Aprovisionamiento de tenant "${slug}" falló, limpiando DB "${dbName}": ${(err as Error).message}`,
      );
      if (tenantDataSource?.isInitialized) {
        await tenantDataSource.destroy();
      }
      await this.dropDatabase(dbName);
      throw err;
    }
  }

  private deriveUsername(email: string): string {
    return email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  }

  private adminConnectionOptions() {
    return {
      type: 'postgres' as const,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_ADMIN_USERNAME || process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_ADMIN_PASSWORD || process.env.DB_PASSWORD || 'postgres',
    };
  }

  // Postgres no permite CREATE DATABASE dentro de una transacción — se usa una
  // conexión cruda a la DB "postgres" por defecto, no al DataSource de negocio.
  private async createDatabase(dbName: string): Promise<void> {
    const adminDataSource = new DataSource({ ...this.adminConnectionOptions(), database: 'postgres' });
    await adminDataSource.initialize();
    try {
      await adminDataSource.query(`CREATE DATABASE "${dbName}"`);
      this.logger.log(`Base de datos "${dbName}" creada.`);
    } finally {
      await adminDataSource.destroy();
    }
  }

  private async dropDatabase(dbName: string): Promise<void> {
    const adminDataSource = new DataSource({ ...this.adminConnectionOptions(), database: 'postgres' });
    await adminDataSource.initialize();
    try {
      // Cierra cualquier conexión residual a la DB antes de poder dropearla.
      await adminDataSource.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminDataSource.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      this.logger.warn(`Base de datos "${dbName}" eliminada tras fallo de aprovisionamiento.`);
    } catch (dropErr) {
      this.logger.error(`No se pudo limpiar la base de datos "${dbName}": ${(dropErr as Error).message}`);
    } finally {
      await adminDataSource.destroy();
    }
  }

  // Mismo array `entities` que database.config.ts y TenantConnectionManagerService
  // (nunca duplicado) — crea el schema Postgres necesario y sincroniza la
  // estructura completa desde los decoradores, igual que hace
  // apply-migrations.ts para bootstrap de una DB vacía.
  private async buildAndSyncTenantDataSource(dbName: string): Promise<DataSource> {
    const ds = new DataSource({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: dbName,
      entities: tenantEntities,
      synchronize: false,
      logging: process.env.DB_LOGGING === 'true',
    });
    await ds.initialize();
    await ds.query(`
      CREATE SCHEMA IF NOT EXISTS "sec";
      CREATE SCHEMA IF NOT EXISTS "com";
      CREATE SCHEMA IF NOT EXISTS "pos";
      CREATE SCHEMA IF NOT EXISTS "inv";
      CREATE SCHEMA IF NOT EXISTS "tickets";
      CREATE SCHEMA IF NOT EXISTS "crm";
      CREATE SCHEMA IF NOT EXISTS "geo";
      CREATE SCHEMA IF NOT EXISTS "net";
    `);
    await ds.synchronize();

    // Asegurar tabla de control de migraciones y registrar línea base.
    //
    // IMPORTANTE: no basta con marcar cada migración histórica como "aplicada"
    // sin ejecutarla — synchronize() solo refleja lo que las entidades
    // TypeORM declaran hoy, y cualquier migración que no tenga una entidad
    // decorada 1:1 (backfills de datos, índices parciales, constraints no
    // expresables por decoradores, o un archivo .sql añadido antes de que su
    // entidad existiera) queda marcada "aplicada" sin que su cambio real
    // exista — exactamente el bug que encontramos en el tenant "sumtech" con
    // 051_create_dgii_certification_runs.sql (marcada aplicada desde el
    // 2026-10-01, pero la tabla nunca se creó). Por eso cada migración se
    // ejecuta de verdad aquí (idempotente por convención: CREATE/ADD ...
    // IF NOT EXISTS) y solo se tolera el error si ya quedó cubierta por
    // synchronize() — nunca se marca "aplicada" a ciegas.
    await ds.query(`
      CREATE TABLE IF NOT EXISTS "sec"."schema_migrations" (
        "filename" VARCHAR(255) PRIMARY KEY,
        "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, '../../database/migrations');
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      for (const file of files) {
        const filePath = path.join(migrationsDir, file);
        let sql = fs.readFileSync(filePath, 'utf8');
        sql = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
        try {
          await ds.query(sql);
        } catch (err) {
          this.logger.warn(
            `Migración ${file} no se pudo re-ejecutar tras synchronize() (probablemente ya cubierta por las entidades): ${(err as Error).message}`,
          );
        }
        await ds.query(
          `INSERT INTO "sec"."schema_migrations" ("filename") VALUES ($1) ON CONFLICT ("filename") DO NOTHING`,
          [file],
        );
      }
    }

    return ds;
  }
}
