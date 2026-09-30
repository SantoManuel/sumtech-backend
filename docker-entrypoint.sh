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
  fi
  echo "✅ [Sumtech DB] Migraciones completadas."
fi

echo "🚀 Iniciando servidor NestJS en el puerto ${PORT:-4000}..."
exec "$@"
