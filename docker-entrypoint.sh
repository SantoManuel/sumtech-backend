#!/bin/sh
set -e

# ==============================================================================
# SUMTECH ERP - DOCKER ENTRYPOINT
# ==============================================================================

echo "================================================================="
echo "  SUMTECH BACKEND - INICIALIZANDO CONTENEDOR EN PRODUCCIÓN       "
echo "================================================================="

# Ejecutar migraciones automáticas al arrancar si está habilitado (default: true)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "🚀 [Sumtech DB] Verificando y aplicando migraciones de esquema..."
  if [ -f "dist/database/apply-migrations.js" ]; then
    node dist/database/apply-migrations.js || echo "⚠️  Advertencia: Hubo un detalle en las migraciones de tenant o la base de datos ya está sincronizada."
  fi

  if [ -n "$PLATFORM_DB_DATABASE" ] && [ -f "dist/database/apply-platform-migrations.js" ]; then
    echo "🏢 [Sumtech Platform] Aplicando migraciones de plataforma SaaS..."
    node dist/database/apply-platform-migrations.js || echo "⚠️  Advertencia: Error en migraciones de plataforma."

    # "apply-migrations.js" de arriba solo migra la base legacy de un solo
    # tenant (sumtech_erp, ver DB_DATABASE); las bases reales por tenant
    # (tenant_<slug>) nunca las toca nadie automático -- antes, el único
    # camino era "npm run migrate:all-tenants" a mano, así que un deploy con
    # una migración nueva dejaba a todos los tenants existentes desalineados
    # hasta que alguien se acordara de correrlo (bug real: la tabla
    # onu_tr069_operations nunca llegaba a ningún tenant ya creado). Gateado
    # igual que la migración de plataforma (requiere PLATFORM_DB_DATABASE,
    # porque necesita leer "platform"."tenants" para saber a quién migrar).
    if [ -f "dist/database/migrate-all-tenants.js" ]; then
      echo "🏢 [Sumtech Tenants] Aplicando migraciones pendientes a cada base de datos de tenant..."
      node dist/database/migrate-all-tenants.js || echo "⚠️  Advertencia: Hubo un detalle migrando una o más bases de tenant; revisa el log anterior."
    fi
  fi
  echo "✅ [Sumtech DB] Migraciones completadas."
fi

echo "🚀 Iniciando servidor NestJS en el puerto ${PORT:-4000}..."
exec "$@"
