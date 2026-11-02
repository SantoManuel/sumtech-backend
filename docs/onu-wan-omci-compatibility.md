# WAN PPPoE OMCI: implementación y pruebas de laboratorio

Actualizado: 2 de noviembre de 2026. Código implementado; validación con equipos a cargo del administrador de la red.

## Alcance operativo

La primera receta implementa PPPoE IPv4 mediante `wan-ip` en OLT ZTE C320, sobre una ONU previamente autorizada en modo Router. La gestión TR-069 permanece independiente. No se configura el servidor PPPoE de MikroTik desde esta operación.

No hay modelos certificados automáticamente. Cada receta queda vinculada al serial físico, firmware OLT, firmware ONU declarado, perfil ONU, perfil VLAN, índice WAN y host. `PILOT` habilita exclusivamente una prueba explícita de ese equipo; `VALIDATED` requiere registrar el resultado de las pruebas. Una receta no se hereda al reemplazar una ONU.

El driver comprueba el serial y tipo reales antes de escribir. Si la salida permite leer el firmware ONU, debe coincidir; una receta `VALIDATED` exige que se pueda comprobar. En `PILOT`, si el firmware no aparece en `detail-info`, su identificación queda atestiguada manualmente para ese serial. Esto permite obtener evidencia inicial sin afirmar que el modelo esté certificado.

La receta actual actualiza/crea el enlace PPPoE por `wan-ip`. Presupone que el modo Router, los enlaces GPON/VEIP, NAT y las asociaciones LAN/SSID necesarias para ese firmware están correctamente preparados. No intenta adivinar comandos de NAT o bindings específicos de fabricantes. Estos requisitos forman parte de la prueba de conectividad.

## Preparar la instalación

1. Aplicar la migración tenant `106_onu_wan_provisioning.sql` mediante el mecanismo existente de migraciones de Sumtech; para todos los tenants, usar `npm run migrate:all-tenants` en el backend con la configuración correspondiente al entorno.
2. Desplegar el backend y frontend del mismo cambio. El backend anterior no conoce la propiedad WAN ni sus bloqueos y no es una versión de recuperación adecuada para equipos ya administrados por OMCI.
3. Comprobar que la OLT tiene modelo C320 y firmware inventariado, que el tipo ONU coincide con el equipo y que existe una VLAN de servicio real.
4. En el contrato, guardar usuario y contraseña PPPoE propios. No se aceptan una VLAN inventada ni una contraseña compartida de respaldo.
5. Preparar en laboratorio el perfil VLAN de la OLT y comprobar su mapeo. La implementación consulta `show gpon onu profile vlan` y exige el perfil indicado, `Tag mode: tag` y el CVLAN correcto. No modifica un perfil compartido ni crea uno con nombres heredados de otra plataforma.
6. Revisar las tareas pendientes del dispositivo en GenieACS. El cambio a OMCI se detiene mientras exista alguna tarea pendiente; no elimina tareas automáticamente.

## Registrar una ONU de laboratorio

En la ficha de la ONU, abrir **Configurar WAN de Internet → Compatibilidad OMCI: configuración de laboratorio** con un usuario ADMIN o GERENTE.

Completar firmware ONU, nombre del perfil VLAN existente, índice WAN, IP-host, autenticación PPP y referencia de las pruebas. Guardar inicialmente con la habilitación desmarcada permite registrar los datos sin escribir en la OLT. Para probar, seleccionar `Prueba de laboratorio` y habilitar las aplicaciones para ese serial.

El IP-host 2 está reservado cuando la ONU tiene el canal TR-069 generado por Sumtech. No usarlo para la WAN de Internet.

El registro también está disponible mediante `POST /olt/onus/:id/wan-omci-profile`, con permisos administrativos y el cuerpo siguiente, sustituyendo todos los datos por los observados en el equipo:

```json
{
  "oltId": "UUID_REAL_DE_LA_OLT",
  "enabled": false,
  "validation": "PILOT",
  "serialNumber": "SERIAL_REAL",
  "oltFirmware": "FIRMWARE_OLT_REAL",
  "onuFirmware": "FIRMWARE_ONU_REAL",
  "vendorTypeName": "TIPO_REAL_EN_OLT",
  "vlanProfile": "PERFIL_EXISTENTE",
  "serviceVlan": 400,
  "wanIndex": 1,
  "hostId": 1,
  "auth": "auto",
  "evidence": "Referencia del laboratorio y observaciones iniciales."
}
```

No registrar contraseñas en la referencia de pruebas. La cuenta PPPoE se resuelve exclusivamente desde el acceso del contrato.

## Aplicar y observar

1. Seleccionar **Desde la OLT (OMCI)**, PPPoE e IPv4 y pulsar **Aplicar PPPoE mediante OLT**.
2. El backend toma el bloqueo de la ONU, valida versiones/credenciales/compatibilidad, comprueba la cola ACS y registra la operación. Nunca reautoriza ni ejecuta `no onu` en esta ruta.
3. El driver lee identidad, perfil VLAN y configuración antes de enviar `wan-ip`. Luego guarda y vuelve a consultar configuración y estado OMCI. No reinicia automáticamente.
4. Revisar el estado y usar **Consultar resultado WAN**. La página también consulta el estado guardado cada ocho segundos mientras hay una operación pendiente y la pestaña está visible.
5. Comprobar por separado sesión PPPoE real en el concentrador, dirección asignada y navegación por Ethernet y Wi-Fi. `APPLIED` significa configuración confirmada por el mecanismo de gestión; no acredita por sí solo navegación del cliente.

La receta admite credenciales que puedan representarse como tokens CLI simples, sin espacios, comillas o caracteres de control. Los valores no representables se rechazan antes de conectarse; no se alteran ni se recortan silenciosamente.

## Estados y recuperación

### Conflicto 409 al enviar WAN mediante TR-069

La cola TR-069 se comprueba por tipo de tarea: una consulta `getParameterValues`/`refreshObject` o una escritura independiente de Wi-Fi no impide enviar una WAN. Se bloquean las escrituras WAN/ManagementServer, creación/eliminación de objetos WAN, reinicios, restauraciones, descargas de firmware y tareas de formato desconocido. El cambio de propiedad a OMCI conserva la comprobación conservadora de toda la cola.

Cuando existen tareas que bloquean, la respuesta incluye `code: WAN_ACS_TASKS_PENDING` y `pendingTasks` con identificadores y nombres, sin parámetros ni contraseñas. Revisar **TR-069 / GenieACS → Historial de Actividad** para conocer las tareas y fallos reales. Eliminar toda la cola no forma parte de esta corrección.

Al verificar una operación TR-069, las consultas independientes pendientes tampoco impiden confirmar una tarea WAN ya completada mediante lectura fresca. Las tareas WAN pendientes siguen impidiendo esa confirmación.

| Estado | Interpretación |
|---|---|
| NOT_CONFIGURED | No hay una WAN aplicada por este flujo, o el equipo fue reemplazado/reautorizado. |
| PENDING / APPLYING | Hay intención pendiente o una ejecución en curso. |
| QUEUED | GenieACS aceptó la tarea para ejecutarla posteriormente. |
| VERIFYING | Falta confirmar la configuración mediante una lectura válida. |
| APPLIED | Se confirmó la configuración de la versión indicada. La sesión PPPoE se comprueba aparte. |
| ERROR | Fallo conocido o intención invalidada por cambio de credenciales/equipo. |
| UNKNOWN | El resultado puede haber aplicado parcialmente; no se reenvía automáticamente. |

Para resultados OMCI inciertos, consultar primero el equipo. Una lectura sin acceso a la contraseña no basta para certificar una escritura que perdió su respuesta. El botón **Reintentar tras revisar el equipo** registra la decisión del operador y vuelve a aplicar después de comprobar que no quedan tareas ACS pendientes.

Cuando un CPE todavía no existe en GenieACS, o el configurador no está disponible antes de escribir, el reconciliador puede reintentar hasta cinco veces con espera progresiva. Reutiliza la versión de intención y aumenta el contador de intentos. No aplica esta política a desconexiones durante una escritura.

Al cambiar las credenciales de `network_access`, un trigger toma el mismo bloqueo de base de datos, invalida tareas anteriores y deja pendiente la nueva intención. Las operaciones WAN TR-069 manuales ajenas al orquestador se rechazan para una WAN ya versionada; las credenciales se editan en el acceso de red del contrato.

Para detener nuevas escrituras OMCI, deshabilitar la receta del serial. Esto no restaura la configuración física. Para regresar a TR-069, confirmar el resultado anterior y seleccionar ese método en la ficha. Las recuperaciones de configuración física anterior deben usar el procedimiento comprobado en el laboratorio; no existe rollback transaccional de OMCI.

## Matriz de aceptación en equipos

Registrar para cada combinación: OLT/software, ONU/firmware, serial, `vendorTypeName`, VLAN/perfil, índices WAN/host y referencia de evidencias sin secretos.

- [ ] Primera aplicación PPPoE IPv4 y actualización de cuenta.
- [ ] Consulta del serial, perfil y estado OMCI reconocida por el parser.
- [ ] Perfil VLAN correcto y rechazo de un CVLAN equivocado.
- [ ] Sesión PPPoE en MikroTik y navegación por los puertos/SSID previstos.
- [ ] Persistencia después de un reinicio controlado del equipo de laboratorio.
- [ ] Segunda solicitud equivalente sin duplicar conexiones.
- [ ] TR-069 sigue reportando y permite gestión/Wi-Fi sin sobrescribir la WAN.
- [ ] Tarea ACS pendiente bloquea el cambio de método.
- [ ] Cambio de contraseña aplica la nueva intención por el método elegido.
- [ ] Desconexión/rechazo OMCI deja un resultado verificable y no provoca un reenvío automático.
- [ ] Retorno explícito a TR-069 y procedimiento de recuperación documentados.

Solo después de completar estas pruebas cambiar la receta a `VALIDATED`. No agregar variantes de firmware a una lista general por asumir compatibilidad del fabricante.

## Verificación de software y SQL

Las suites de software usan sesiones simuladas y no certifican equipos. La prueba SQL optativa está en `src/database/__tests__/onu-wan-migration.integration.spec.ts`. Requiere una base PostgreSQL local y descartable llamada `sumtech_wan_test`, sin esquema `net` previo; crea los objetos dentro de una transacción y revierte al terminar.

Verificación local de esta entrega: **830 pruebas backend y 28 frontend aprobadas**, además de builds de producción correctos para ambos proyectos. Los cuatro casos PostgreSQL quedaron omitidos explícitamente, sin confundirse con pruebas aprobadas.

```powershell
$env:WAN_MIGRATION_TEST_URL = 'postgresql://USUARIO:CLAVE@127.0.0.1:5432/sumtech_wan_test'
npm test -- --runInBand --runTestsByPath src/database/__tests__/onu-wan-migration.integration.spec.ts
```

Sin esa variable, los cuatro casos SQL se omiten explícitamente. En el entorno de desarrollo usado para esta entrega no había PostgreSQL de pruebas ni daemon Docker disponible, por lo que no se ejecutó esta integración ni se aplicaron migraciones sobre tenants.

## Referencias y automatizaciones

La distinción HTTP 200/202 de tareas y la consulta de colecciones se apoyan en la [referencia oficial NBI de GenieACS](https://github.com/genieacs/genieacs/blob/master/docs/api-reference.rst). Se usa lectura CWMP explícita antes de considerar una comparación como confirmada.

La lectura de perfiles se basa en la sección 2.5 del [manual CLI ZTE C320](https://noname.com.ua/mediawiki/images/2/2a/Zxa10-c320-configuration-manual-cli-v2.pdf), documentación del fabricante alojada en un tercero. La receta sigue pendiente de contraste con el software de la OLT del laboratorio.

Se revisaron los provisions de `sumtech_servidor_genieacs/config/provisions`. Los incluidos actualmente no escriben WAN PPPoE/IP: `bootstrap` consulta el árbol y `default_wan_wifi` escribe Wi-Fi, QoS e IPTV. Se conserva el tag `WAN_OMCI` como señal para futuras automatizaciones. Presets, scripts o cambios manuales externos a estos repositorios deben incluirse en la comprobación de laboratorio; el bloqueo del ERP no controla escritores externos.
