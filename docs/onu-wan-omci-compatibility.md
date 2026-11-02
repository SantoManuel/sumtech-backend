# Configuración WAN PPPoE mediante OMCI

Actualizado: 2 de noviembre de 2026. La selección OMCI permite enviar directamente la configuración a la OLT. No requiere registrar compatibilidad, firmware, recetas, rangos LAN/SSID ni una habilitación de laboratorio.

## Flujo de uso

1. Abrir la ficha de una ONU autorizada en una OLT ZTE C320 y en modo Router.
2. Seleccionar **Desde la OLT (OMCI)** en **Configurar WAN de Internet**.
3. Pulsar **Aplicar PPPoE mediante OLT**.

El backend obtiene la interfaz y el serial de la ONU, la VLAN del servicio y las credenciales PPPoE del acceso de red del contrato. La gestión TR-069 es independiente; no hay que aplicar un perfil TR-069 para usar OMCI.

Se conservan las validaciones del servicio: ONU autorizada, modo Router, VLAN real y usuario/contraseña del contrato. En Bridge, la conexión PPPoE corresponde al router externo.

## Comandos aplicados

El bloque estándar es el aportado por el usuario para OLT-TABARA-ABAJO. Se ejecutan cinco comandos separados, esperando la respuesta CLI de cada uno:

```text
configure terminal
pon-onu-mng <interfaz_de_la_onu>
wan 1 ethuni <puertos_lan> ssid 1-4 service internet
wan 1 service internet host 1 pppoe
pppoe 1 user <usuario_del_contrato> password <contraseña_del_contrato>
pppoe 1 nat enable
vlan wan 1 mode tag vlan <vlan_del_servicio>
end
write
```

WAN e IP-host usan 1. LAN usa los puertos declarados para el modelo, hasta cuatro; si el inventario no declara una cantidad, se usa `1-4`, como en el bloque aportado. SSID usa `1-4`. No se pide al operador configurar estos parámetros en un formulario adicional.

Credenciales y NAT se envían en líneas separadas para evitar concatenación o truncamiento. La VLAN no está fijada en 400: se toma del servicio. El usuario y la contraseña del ejemplo no se incluyen como valores de producción.

No se consulta un perfil VLAN con nombre para este bloque, porque el etiquetado se configura con `vlan wan`. Tampoco se reautoriza la ONU ni se ejecuta `no onu`.

Los valores que no puedan representarse como tokens CLI simples se rechazan sin alterarlos ni recortarlos. Las contraseñas se redactan en logs, errores y evidencias.

## Estado y comprobación

Antes de escribir se comprueba que el serial leído en la OLT corresponde a la ONU elegida. El nombre de tipo se contrasta cuando el inventario lo conoce; no se exige inventariar el firmware para enviar los comandos estándar.

Después de `write` se consulta la configuración y el estado OMCI. Para confirmar `APPLIED` deben coincidir servicio Internet/PPPoE, host, usuario, NAT habilitado, VLAN tag y asociaciones LAN/SSID. La sesión PPPoE y la navegación se comprueban por separado en el concentrador y el cliente.

Los resultados `VERIFYING` o `UNKNOWN` conservan la operación pendiente de confirmar. Usar **Consultar resultado WAN**; un timeout durante la escritura no provoca un reenvío automático. **Reintentar tras revisar el equipo** permite una decisión explícita del operador.

Las opciones efectivamente enviadas se guardan internamente en el JSON existente `omci_wan_profile` para la comprobación y los reintentos. Son estado de ejecución, no datos que el usuario tenga que registrar antes. La marca interna `STANDARD` identifica la configuración resuelta automáticamente y no certifica por sí sola todos los modelos o firmwares.

## Compatibilidad con configuraciones anteriores

Una WAN OMCI que ya se aplicó con la variante `wan-ip` conserva sus opciones guardadas para evitar mover una conexión existente a otro mecanismo de forma implícita. Los registros de laboratorio no aplicados o deshabilitados ya no bloquean el envío del bloque estándar.

La pantalla de registro de compatibilidad fue retirada. La API administrativa anterior se conserva para compatibilidad con clientes existentes, pero no interviene como requisito en el flujo de envío.

Si la lectura detecta un IP-host compartido con otra WAN o una mezcla de mecanismos en el mismo índice, se informa el conflicto antes de sobrescribir otra conexión. Los estados inciertos de operaciones anteriores deben revisarse como cualquier otro cambio WAN en curso.

## Tareas de GenieACS y conflictos 409

El cambio de propiedad WAN a OMCI comprueba la cola ACS para evitar una escritura anterior que sobrescriba después la configuración. No se eliminan tareas automáticamente.

Para TR-069, las consultas `getParameterValues`/`refreshObject` y las escrituras independientes de Wi-Fi no bloquean el envío. Las tareas WAN/ManagementServer, reinicios, restauraciones, firmware y formatos desconocidos siguen generando un conflicto. La respuesta `WAN_ACS_TASKS_PENDING` incluye identificadores y tipos, sin parámetros secretos.

Consultar **TR-069 / GenieACS → Historial de Actividad** para revisar tareas y fallos reales. Eliminar una tarea no revierte cambios ya aplicados.

## Migración, despliegue y pruebas

Esta simplificación no requiere una migración nueva. Sigue siendo necesaria la migración 106 para las columnas e historial WAN originales. Backend y frontend deben desplegarse con esta actualización para que el servidor deje de exigir compatibilidad y la página retire el formulario.

El código se comprueba con sesiones simuladas; no se enviaron comandos a equipos de producción. Para la aceptación física, verificar primera aplicación, sesión PPPoE, navegación LAN/Wi-Fi, persistencia después de un reinicio controlado y convivencia con la gestión TR-069.

Verificación local de esta actualización: 44 suites de regresión OLT/GenieACS aprobadas; 33 casos del servicio WAN y 25 casos de la ficha ONU aprobados en sus últimas ejecuciones. Builds de producción de backend y frontend correctos. Se cubren el envío sin registro previo, la selección OMCI desde TR-069 sin perfil ACS y la repetición sin volver a escribir en la OLT.

La prueba optativa SQL está en `src/database/__tests__/onu-wan-migration.integration.spec.ts`. Requiere PostgreSQL local y una base descartable `sumtech_wan_test`, sin esquema `net` previo. Sus cuatro casos siguen pendientes de un entorno de pruebas disponible; no se aplicaron migraciones a tenants durante este trabajo.

Los provisions incluidos en `sumtech_servidor_genieacs/config/provisions` no escriben WAN PPPoE/IP. Los presets o scripts externos a estos repositorios deben incluirse en la validación con equipos.
