# Vinculación de ONUs con GenieACS por serial o MAC de gestión

El serial GPON permanece intacto para autenticar la ONU ante la OLT. El serial TR-069, el device ID y la MAC de gestión son identidades independientes. Una vinculación verificada por MAC exacta permite las mismas operaciones WAN, PPPoE y Wi-Fi que una vinculación por serial.

## Fuente y resolución

Para ZTE se utiliza exclusivamente la MAC leída en `show gpon remote-onu ip-host`, Host ID 2. No se reutiliza `onu.mac` ni la tabla de MACs aprendidas detrás del Bridge. La auditoría, verificación TR-069 y sincronización capturan la MAC; WAN y Wi-Fi consultan el host antes de resolver la identidad desde la ficha de la ONU.

El resolvedor común busca serial exacto (incluidas variantes GPON ASCII/hexadecimal) y MAC exacta. Normaliza formatos Cisco, con dos puntos, guiones y hexadecimal continuo. Rechaza cero, broadcast, multicast y formatos incompletos. Nunca utiliza aproximaciones de octetos para vincular ONUs.

Se rechazan coincidencias múltiples, serial y MAC que apuntan a equipos distintos, cambios respecto de una vinculación existente y MACs que ya no aparecen en el documento consultado. La IP sirve para diagnóstico, no para identificar el equipo.

La plataforma reserva globalmente el device ID y la MAC para un par tenant/ONU, con bloqueo transaccional e índices únicos. Antes de la primera reserva se comprueban las vinculaciones históricas de los tenants y contratos, además de los tags TENANT. Si no se puede verificar la pertenencia, no se permite escribir. La eliminación confirmada de una ONU libera su reserva; una identidad contradictoria no se reasigna automáticamente.

Los cambios de vinculación se registran en `net.onu_genieacs_identity_events`. La configuración WAN conserva sus comprobaciones de aplicación: resolver la identidad no confirma por sí mismo una escritura.

## Despliegue

1. Subir los cambios y desplegar backend y frontend en Coolify. La compilación copia ambos archivos SQL a `dist`; no requieren registro manual en una lista.
2. Al arrancar el backend, el entrypoint ejecuta las migraciones automáticamente: base legacy, plataforma y tenants `ACTIVE`/`TRIAL`. `RUN_MIGRATIONS` debe estar ausente o valer `true`, y `PLATFORM_DB_DATABASE` debe estar configurada.
3. Confirmar en los logs y tablas `schema_migrations` que `004_genieacs_identity_claims.sql` quedó aplicada en plataforma y `108_onu_genieacs_identity.sql` en cada tenant. El entrypoint actual continúa arrancando incluso si un ejecutor falla; el mensaje final de arranque no demuestra por sí solo que todas las migraciones terminaron correctamente.
4. En la ficha de la ONU, ejecutar **Sincronizar vía TR-069** para capturar la MAC y resolver la vinculación. La auditoría también captura la MAC sin reenviar aprovisionamiento físico.

Con esta configuración no hace falta ejecutar las migraciones manualmente. Reiniciar una imagen anterior no incorpora archivos SQL nuevos: Coolify debe construir y desplegar la versión que los contiene.

No hay backfill de MACs históricas de procedencia desconocida. No es necesario reautorizar ni reiniciar la ONU para vincularla.

## Caso de aceptación

ONU GPON `ZTEGC288E7C5`, interfaz `gpon-onu_1/3/1:3`, MAC IP-host 2 `2cb2.7266.23eb` y dispositivo `2CB272-F660-ZTEGC687ABB0234` deben vincularse por `MAC`. El serial GPON permanece `ZTEGC288E7C5`; el serial TR-069 se guarda como `ZTEGC687ABB0234`. La ficha muestra ambas identidades y el método de vinculación.

El mensaje de ausencia de vinculación no afirma que nunca existió un Inform. Los errores de conexión y los conflictos se comunican por separado. La interfaz no intenta saltarse un rechazo de identidad enviando un refresh directo.

La validación automatizada usa sesiones y clientes simulados. Este cambio local no despliega ni aplica migraciones en producción; la vinculación real del caso de aceptación debe comprobarse después del despliegue, antes de realizar cambios de servicio.
