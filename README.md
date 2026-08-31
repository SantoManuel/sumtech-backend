# Sumtech Backend

Backend del ERP **Sumtech** para una empresa de telecomunicaciones (internet y cable) en República Dominicana. Es un monolito modular construido con **NestJS**, **PostgreSQL** (esquema 3NF multi-schema) y **TypeORM**, con facturación electrónica DGII (e-CF), punto de venta, gestión de clientes/contratos, tickets de soporte técnico e inventario con trazabilidad de equipos.

## Stack tecnológico

- **Runtime/Framework**: Node.js + [NestJS 10](https://nestjs.com/)
- **Base de datos**: PostgreSQL (múltiples esquemas: `sec`, `com`, `pos`, `inv`, `tickets`, `crm`) con [TypeORM](https://typeorm.io/)
- **Autenticación**: JWT (access + refresh token) con RBAC por roles
- **Caché / colas**: Redis (`ioredis`) — carritos de POS, listas de bloqueo de tokens
- **Facturación electrónica**: firma XML (`node-forge`, `@xmldom/xmldom`) e integración DGII (e-CF) en modo sandbox/producción
- **Validación**: `class-validator` / `class-transformer`
- **Tests**: Jest

## Arquitectura

Monolito modular organizado por dominio de negocio. Cada módulo de NestJS vive en `src/modules/<dominio>` con su propio controller, service, entidades y DTOs. La base de datos se organiza en esquemas PostgreSQL separados por dominio para mantener un diseño 3NF ordenado:

| Esquema | Contenido |
|---|---|
| `sec` | Usuarios, roles, empleados, auditoría, control de migraciones |
| `com` | Clientes, direcciones, contratos, planes de servicio |
| `pos` | Punto de venta, cajas registradoras, ventas, facturas e-CF |
| `inv` | Inventario: productos, equipos serializados, kardex, almacenes, materiales a granel |
| `tickets` | Órdenes de trabajo, SLA, historial, reparaciones, calendario |
| `crm` | Prospectos (leads) e interacciones comerciales |

## Módulos principales

- **Auth** — login, refresh token, JWT con roles embebidos
- **Users / Employees** — usuarios del sistema y personal (con roles RBAC: `ADMIN`, `GERENTE`, `CAJERO`, `TECNICO`, `AGENTE_CRM`, `CLIENTE`)
- **Clients** — clientes, direcciones y contratos de servicio
- **Plans** — catálogo de planes de internet/TV
- **Inventory** — catálogo de productos, trazabilidad de equipos serializados (almacén → técnico → cliente), materiales a granel, kardex de movimientos y ajustes de conteo físico
- **POS** — checkout transaccional, cajas registradoras, cierre de turno
- **Invoicing / DGII** — emisión y firma de comprobantes fiscales electrónicos (e-CF), certificación, reportes fiscales (607, SLA, inventario, suscriptores)
- **Tickets** — órdenes de instalación/reparación/mantenimiento, SLA, reemplazo de hardware en campo, calendario de coordinación
- **CRM** — gestión de leads e interacciones
- **Dashboard** — KPIs consolidados (suscriptores, ingresos, tickets, inventario crítico)
- **Portal** — endpoints de autoservicio para el cliente final
- **Coordination** — orquestación de eventos entre módulos (ej. venta confirmada → activar contrato)

## Requisitos previos

- Node.js 18+
- PostgreSQL 14+ (con extensión `pgcrypto` para `gen_random_uuid()`)
- Redis (opcional para desarrollo local, requerido para carritos de POS)

## Instalación

```bash
npm install
cp .env.example .env
```

Edita `.env` con tus credenciales locales (base de datos, JWT secrets, Redis, credenciales DGII sandbox). **Nunca subas `.env` al repositorio** — ya está excluido en `.gitignore`.

### Variables de entorno principales

| Variable | Descripción |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` | Conexión a PostgreSQL |
| `DB_SYNCHRONIZE` | `true` solo en desarrollo local rápido; **siempre `false` en producción** (usar migraciones controladas) |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Firmas de tokens de acceso y refresco |
| `REDIS_HOST`, `REDIS_PORT` | Conexión a Redis |
| `DGII_ENVIRONMENT`, `DGII_RNC_EMISOR`, `DGII_CERT_PATH` | Configuración de facturación electrónica (sandbox/producción) |

## Base de datos: migraciones y datos de prueba

El proyecto no depende de `synchronize` en producción; usa migraciones SQL versionadas en `src/database/migrations/`, aplicadas una única vez cada una (registro de control en `sec.schema_migrations`):

```bash
npm run migrate
```

Para poblar una base de datos de desarrollo con datos de ejemplo (usuarios, clientes, contratos, inventario, tickets, etc.) — este comando también sincroniza el esquema completo vía TypeORM, pensado para bases de datos **nuevas/vacías**:

```bash
npm run seed
```

## Ejecución

```bash
# Desarrollo (hot-reload)
npm run start:dev

# Producción
npm run build
npm run start:prod
```

La API queda disponible en `http://localhost:4000/api/v1` (prefijo y puerto configurables vía `.env`).

## Pruebas

```bash
npm run test        # Pruebas unitarias
npm run test:cov    # Con reporte de cobertura
npm run test:e2e    # Pruebas end-to-end
```

## Estructura del proyecto

```
src/
├── common/            # Decoradores, DTOs, guards, filtros e interceptores compartidos
├── config/            # Configuración de base de datos, JWT, Redis, DGII
├── database/
│   ├── migrations/    # Migraciones SQL versionadas (una sola aplicación por archivo)
│   └── seeds/         # Script de datos de ejemplo para desarrollo
└── modules/           # Un módulo NestJS por dominio de negocio (ver tabla anterior)
```

## Seguridad y control de acceso

Todos los endpoints (salvo los marcados como públicos) requieren un JWT válido (`AuthGuard`) y se filtran por rol (`RolesGuard` + decorador `@Roles(...)`). Los roles del sistema son: `ADMIN`, `GERENTE`, `CAJERO`, `TECNICO`, `AGENTE_CRM`, `CLIENTE`.

## Licencia

Software privado — uso interno de Sumtech. Todos los derechos reservados.
