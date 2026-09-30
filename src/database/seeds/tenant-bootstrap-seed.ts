import { DataSource } from 'typeorm';
import { RoleEntity } from '../../modules/users/entities/role.entity';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { CompanyProfileEntity } from '../../modules/company/entities/company-profile.entity';
import { SubscriptionStatusEntity } from '../../modules/crm/entities/subscription-status.entity';
import { NextActionEntity } from '../../modules/crm/entities/next-action.entity';
import { LossReasonEntity } from '../../modules/crm/entities/loss-reason.entity';
import { RoundRobinCursorEntity } from '../../modules/crm/entities/round-robin-cursor.entity';

export interface TenantBootstrapInput {
  adminUsername: string;
  adminEmail: string;
  adminPasswordHash: string;
  adminName: string;
  // Datos del registro (Fase 3) para sembrar el CompanyProfileEntity inicial
  // de este tenant — sin esto, `CompanyService.getProfile()` igual funciona
  // (get-or-create con un placeholder genérico), pero un tenant que SÍ dio su
  // nombre/RNC al registrarse no debería nacer con "Mi Empresa" / RNC en
  // ceros (Fase 4 del plan multi-tenant).
  companyName: string;
  rnc?: string;
}

const DEFAULT_SITE_CONTENT = {
  hero: {
    title: 'Internet de fibra óptica confiable',
    subtitle: 'Configura el contenido de tu sitio público desde Configuración > Empresa.',
  },
  about: '',
  faq: [],
  officeInfo: {},
  equipmentShowcase: [],
  clientLogos: [],
};

// Catálogo de roles base — mismo set que initial-seed.ts (no lo reinventa),
// pero SIN los datos de demostración (clientes/ventas/tickets ficticios) que
// initial-seed.ts sí siembra: un tenant nuevo real no debe nacer con datos de
// ejemplo de Sumtech Ramírez.
const BASE_ROLES = [
  { name: 'ADMIN', description: 'Administrador total del sistema ERP' },
  { name: 'GERENTE', description: 'Gerencia de Operaciones y Finanzas' },
  { name: 'CAJERO', description: 'Operador de Punto de Venta y Cobros' },
  { name: 'TECNICO', description: 'Técnico de Campo para Instalaciones y Averías' },
  { name: 'AGENTE_CRM', description: 'Ejecutivo de Ventas y Atención al Cliente' },
  { name: 'CLIENTE', description: 'Portal de Autoservicio y Autogestión del Cliente' },
];

// Catálogo del pipeline comercial del CRM — mismos códigos que la migración
// 046_create_crm_opportunity_model.sql siembra para bases YA existentes
// (sumtech_erp), replicado aquí porque un tenant nuevo se bootstrapea vía
// `synchronize()` (Fase 3), que crea las TABLAS desde los decoradores pero
// nunca corre el replay de `.sql` — y sin este catálogo, `PublicService.
// createLead()` (usado por "Solicitar Instalación" del sitio público) falla
// con un 500 real al no encontrar el código "PROSPECTO". Encontrado
// verificando ese flujo end-to-end en la Fase 4; a diferencia de los seeds
// de warehouse/NCF que sí son específicos del entorno original de Sumtech,
// este catálogo es genérico y todo tenant lo necesita — por eso se replica
// aquí en vez de diferirlo a la Fase 8 (migración fan-out de tenants YA
// aprovisionados, no aplica a un tenant que nace hoy).
const CRM_SUBSCRIPTION_STATUSES = [
  { code: 'PROSPECTO', name: 'Prospecto', sortOrder: 1 },
  { code: 'EN_NEGOCIACION', name: 'En Negociación', sortOrder: 2 },
  { code: 'SUSCRIPCION_ACTIVA', name: 'Suscripción Activa', sortOrder: 3 },
  { code: 'PERDIDA', name: 'Pérdida', sortOrder: 4 },
];

const CRM_NEXT_ACTIONS = [
  { code: 'LLAMAR_PRESENTACION', name: 'Llamar para presentación', suggestedStatusCodes: ['PROSPECTO'], sortOrder: 1 },
  { code: 'ENVIAR_PROPUESTA', name: 'Enviar propuesta', suggestedStatusCodes: ['PROSPECTO', 'EN_NEGOCIACION'], sortOrder: 2 },
  { code: 'REUNION_CIERRE', name: 'Reunión de cierre', suggestedStatusCodes: ['EN_NEGOCIACION'], sortOrder: 3 },
  { code: 'LLAMAR_SEGUIMIENTO', name: 'Llamar para seguimiento', suggestedStatusCodes: ['PROSPECTO', 'EN_NEGOCIACION', 'PERDIDA'], sortOrder: 4 },
  { code: 'ENVIAR_ENCUESTA', name: 'Enviar encuesta de satisfacción', suggestedStatusCodes: ['SUSCRIPCION_ACTIVA'], sortOrder: 5 },
];

const CRM_LOSS_REASONS = [
  { name: 'Precio', sortOrder: 1 },
  { name: 'Cobertura no disponible', sortOrder: 2 },
  { name: 'Eligió otro proveedor', sortOrder: 3 },
  { name: 'Sin respuesta', sortOrder: 4 },
  { name: 'Otro', sortOrder: 5 },
];

export async function seedCrmCatalogs(dataSource: DataSource): Promise<void> {
  const statusRepo = dataSource.getRepository(SubscriptionStatusEntity);
  for (const s of CRM_SUBSCRIPTION_STATUSES) {
    const existing = await statusRepo.findOneBy({ code: s.code });
    if (!existing) await statusRepo.save(statusRepo.create(s));
  }

  const actionRepo = dataSource.getRepository(NextActionEntity);
  for (const a of CRM_NEXT_ACTIONS) {
    const existing = await actionRepo.findOneBy({ code: a.code });
    if (!existing) await actionRepo.save(actionRepo.create(a));
  }

  const reasonRepo = dataSource.getRepository(LossReasonEntity);
  for (const r of CRM_LOSS_REASONS) {
    const existing = await reasonRepo.findOneBy({ name: r.name });
    if (!existing) await reasonRepo.save(reasonRepo.create(r));
  }

  const cursorRepo = dataSource.getRepository(RoundRobinCursorEntity);
  const existingCursor = await cursorRepo.findOneBy({ id: 1 });
  if (!existingCursor) await cursorRepo.save(cursorRepo.create({ id: 1 }));
}

/**
 * Siembra el mínimo indispensable para que un tenant recién aprovisionado
 * (Fase 3 del plan multi-tenant) sea utilizable: los roles base del ERP y el
 * primer usuario ADMIN (el TenantAdmin), usando los datos capturados en el
 * registro. Debe correr DESPUÉS de crear los esquemas Postgres y de
 * `dataSource.synchronize()` sobre la DB del tenant.
 */
export async function runTenantBootstrapSeed(
  dataSource: DataSource,
  input: TenantBootstrapInput,
): Promise<UserEntity> {
  const roleRepo = dataSource.getRepository(RoleEntity);
  const userRepo = dataSource.getRepository(UserEntity);

  const savedRoles: Record<string, RoleEntity> = {};
  for (const r of BASE_ROLES) {
    let role = await roleRepo.findOneBy({ name: r.name });
    if (!role) {
      role = await roleRepo.save(roleRepo.create(r));
    }
    savedRoles[r.name] = role;
  }

  const adminUser = await userRepo.save(
    userRepo.create({
      username: input.adminUsername,
      email: input.adminEmail,
      passwordHash: input.adminPasswordHash,
      roles: [savedRoles['ADMIN']],
      isActive: true,
    }),
  );

  await seedCrmCatalogs(dataSource);

  const profileRepo = dataSource.getRepository(CompanyProfileEntity);
  const existingProfile = await profileRepo.findOne({ where: {} });
  if (!existingProfile) {
    await profileRepo.save(
      profileRepo.create({
        name: input.companyName,
        companyName: input.companyName,
        rnc: input.rnc || '000000000',
        email: input.adminEmail,
        currency: 'DOP',
        timezone: 'America/Santo_Domingo',
        isActive: true,
        siteContent: DEFAULT_SITE_CONTENT,
        settings: {},
      }),
    );
  }

  return adminUser;
}
