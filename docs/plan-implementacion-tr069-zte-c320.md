# Plan de implementación: corrección del aprovisionamiento TR-069 ZTE C320

Actualización: 2026-11-04. Fases A–G implementadas en código. Fase H: emulador estricto y validación automatizada implementados; pendientes validación con PostgreSQL/Redis reales, laboratorio óptico y despliegue. No se ejecutaron comandos de configuración contra equipos reales ni se aplicaron migraciones a una base de datos externa.

Estado, archivos, pruebas, configuración y límites de la implementación: [informe de implementación](tr069-implementacion-validacion.md). El resto del documento conserva la especificación de diseño y sus criterios de aceptación; no debe interpretarse su redacción en futuro como una lista actualizada de tareas pendientes.

Decisión actual del usuario: aplicar configuración no requiere reiniciar la ONU, ni durante el script ni al finalizarlo. Esta decisión reemplaza la propuesta inicial de reinicios normales o de recuperación automática. El reinicio queda reservado a una acción explícita del operador.

Objetivo: resolver los diez hallazgos de la revisión de `zte-c320-tr069.ts` mediante ejecución CLI verificable, cambios calculados desde el estado real, recuperación acotada y resultados que distingan configuración de conectividad.

El alcance comprende «Aplicar Perfil TR-069» y «Solo actualizar ACS», sus servicios, persistencia, auditoría, ejecución asíncrona y presentación de resultados. La autorización de Internet conserva su etapa independiente. Los identificadores de recursos de gestión deben validarse contra la configuración observada antes de modificarlos.

Este documento prescribe cambios de software. Las secuencias específicas del firmware y del modelo de ONU requieren validación en laboratorio; los comentarios históricos del código no sustituyen esa evidencia. En particular, no se asume que `%Error 20200` sea un problema de buffer ni que todo rechazo OMCI se resuelva reiniciando.

## 1. Correspondencia entre hallazgos y entregables

| Punto | Problema | Entregable | Criterio de aceptación |
| --- | --- | --- | --- |
| 1 | Respuestas críticas ignoradas | Ejecutor tipado y comprobación de cada comando | Fallar `configure terminal`, GEM o persistencia impide declarar configuración aplicada |
| 2 | Éxito pese al rechazo del ACS | Resultado estructurado y propagación hasta API, DB y auditoría | ACS rechazado nunca produce resultado completo ni evento de éxito completo |
| 3 | Reinicio a mitad del bloque | Aplicación y guardado sin reinicios | Ninguna operación de configuración invoca reinicio, ni durante ni después del bloque |
| 4 | Reinicios indiscriminados | Eliminar el ciclo ACS/reinicio | Rechazos OMCI se reportan sin reiniciar ni repetir seis veces el ACS |
| 5 | Reintento ciego de 20200 y contexto incorrecto | Seguimiento del prompt y precondiciones de modo | Modo equivocado se corrige de forma comprobada o detiene las mutaciones |
| 6 | Credenciales en logs y respuestas | Sanitización central y pruebas de fuga | Secretos de prueba ausentes de logs, excepciones, API, auditoría y trabajos persistidos |
| 7 | Verificación inconclusa silenciosa | Evidencia separada de configuración, OMCI, IP y ACS | Lectura fallida o estado desconocido se devuelve explícitamente |
| 8 | Eliminación con VLAN nueva | Lectura previa, diferencias y compensación | Migrar 46 → 50 elimina asociaciones observadas de 46 y conserva Internet |
| 9 | Mutaciones DHCP globales por ONU | Preflight de red y política independiente por OLT | Aprovisionar una ONU no cambia DHCP snooping global |
| 10 | Esperas y duración sin límite real | Política temporal común, deadline y BullMQ | HTTP devuelve identificador; toda operación termina o pasa a estado inconcluso dentro de su presupuesto |

## 2. Contrato de resultados y estado persistido

Crear `ports/tr069-provisioning.types.ts` y usarlo desde `olt-driver.port.ts`. Definir una unión discriminada con cuatro resultados:

- `failed`: no se alcanzó el objetivo; incluir etapa, código de fallo y si hubo mutaciones.
- `partial`: existen cambios confirmados, pero alguna parte requerida quedó rechazada o sin persistir.
- `applied_unverified`: configuración requerida y persistencia comprobadas; faltan pruebas operativas concluyentes.
- `verified`: configuración comprobada y comunicación con el ACS de destino acreditada con evidencia posterior al cambio.

Para compatibilidad, derivar `ok` del resultado: verdadero para `applied_unverified` y `verified`; falso para `failed` y `partial`. No usarlo para decidir si el dispositivo ya se comunica con GenieACS. Un rechazo del ACS implica `failed` o `partial` según los cambios anteriores, incluso cuando Internet siga funcionando.

Cada resultado debe contener `operationId`, `stage`, `configurationStatus`, `persistenceStatus`, evidencias por capa, incidencias estructuradas, tiempos y contadores de intentos/reinicios. Cada evidencia admite `confirmed`, `failed`, `unknown` o `not_supported`, con fecha, origen y motivo sanitizado. Una funcionalidad no soportada no equivale a éxito.

Separar configuración deseada, configuración observada y resultado operativo. Reutilizar `desiredVersion`, `appliedVersion` y `applyStatus` de `onu-service-config.entity.ts` con reglas explícitas:

- Reservar versión deseada una sola vez al crear la operación; los reintentos conservan esa versión.
- Avanzar `appliedVersion` únicamente cuando las partes requeridas de configuración y su persistencia estén comprobadas.
- Registrar IP/ACS en el resultado operativo de TR-069, sin sobrescribir el estado de Internet ni bloquear su autorización.
- Usar control de versión para impedir que termine una operación antigua sobre una configuración deseada posterior.
- Ajustar `recordPartialOperation` y sus consumidores: pendiente de verificación no debe disparar automáticamente una reaplicación completa.

Actualizar juntos `onu-management.service.ts`, DTO de respuesta y auditoría. Conservar temporalmente `tr069Warning` como resumen derivado. Mapear los eventos a los estados que realmente soporte el esquema; si faltan estados parciales, incluir su migración antes de utilizarlos. Devolver errores de validación antes de encolar; los fallos del equipo quedan consultables en la operación.

## 3. Ejecución CLI y contexto de sesión — puntos 1 y 5

Crear `drivers/zte-command-executor.ts`, compartido por transporte, OMCI, actualización aislada de ACS y verificación. Representar cada paso mediante identificador, modo esperado, comando, clasificación requerida/opcional, condición de equivalencia y política de reintento.

Extender `ZteSessionLike` y `ZteTelnetSession` para conservar metadatos del prompt antes de eliminarlo de la salida: EXEC, configuración global, interfaz ONU, gestión ONU o desconocido. Mantener temporalmente `executeCommand(): Promise<string>` para otros consumidores mediante un adaptador y añadir una operación estructurada. No aceptar únicamente que la última línea termine en `#`: comprobar también el modo esperado.

El ejecutor debe:

1. Verificar el modo inicial y las transiciones de contexto.
2. Clasificar respuesta como aceptada, equivalente comprobada, rechazada o indeterminada.
3. Verificar todos los pasos requeridos, incluidos `configure terminal`, GEM, salidas de modo y `write`.
4. Tratar «ya existe» como motivo de lectura y comparación; la frase sola no prueba que tenga el valor solicitado.
5. Tolerar en una eliminación solo la ausencia explícitamente reconocida del objeto esperado. Sintaxis, permisos y errores de sesión siguen siendo fallos.
6. Distinguir un rechazo recibido de un timeout: un timeout puede haber ocurrido después de aplicar el comando.
7. Tras un timeout o confirmación incompleta, invalidar la sesión para mutaciones; reconectar y observar antes de decidir qué falta ejecutar.
8. Cerrar o restablecer contexto en `finally` sin ocultar el error principal. La limpieza de sesión no sustituye guardar ni confirma la operación.

`%Error 20200` se clasifica como rechazo de entrada/contexto hasta tener evidencia adicional. Si se demuestra modo incorrecto, recuperar el contexto de forma acotada; si persiste o la sintaxis no está soportada, detener la rama dependiente. No repetir a ciegas comandos mutantes.

Aplicar la política a `updateTr069AcsUrlWithSession`, que hoy usa una ruta diferente. En `rebootOnu()` comprobar también rechazos después de la confirmación y no resolver solo por recuperar un prompt.

## 4. Observación previa y cálculo de cambios — punto 8

Crear `drivers/zte-c320-tr069-state.ts` y ampliar parsers con fixtures reales sanitizados. Leer antes de mutar: identidad de ONU/serial, transporte, asociaciones GEM/flow, bind, IP-host, filtros, ACS, etiqueta VLAN, estado OMCI y capacidades relevantes. Consultar el perfil TCONT requerido; si no existe, informar el requisito sin crearlo automáticamente.

Normalizar el estado observado y compararlo con el deseado. Validar VLAN, interfaz, ONU, URL y credenciales antes de interpolar comandos; rechazar saltos de línea y caracteres de control. La política de valores y escapado debe corresponder a la CLI del firmware. No aceptar credenciales parciales ni borrarlas con sintaxis no validada.

Reglas del plan de cambios:

- Estado equivalente: omitir reescritura y reinicio innecesarios.
- Migración 46 → 50: eliminar las asociaciones antiguas realmente observadas, con su prioridad y VLAN reales, y crear las nuevas en orden de dependencias.
- No interpretar un fallo de lectura como ausencia de configuración. Si no se puede determinar qué se va a eliminar, detener la migración antes de destruir.
- Validar que `tcont 2`, `gemport 2`, `service-port 2` e `iphost 2` correspondan al canal administrado. Si hay conflicto con otro servicio, detener y reportarlo.
- Capturar una instantánea suficiente para compensar cambios del canal de gestión. No almacenar secretos sin protección.

Eliminar la reconstrucción incondicional de `service-port 2` y el reenlace automático por «ya existe». Ejecutarlos solo cuando el estado observado lo justifique y verificar después. Una operación fallida debe intentar compensación acotada cuando el estado y la sesión sean conocidos; si no puede restaurarse, registrar `partial` con las diferencias restantes. No prometer atomicidad entre CLI, ONU y base de datos.

La vista previa usará el mismo plan que la ejecución. Diferenciar la plantilla estática del plan calculado desde una lectura real. Antes de aplicar una vista previa antigua, releer y recalcular; ocultar credenciales por defecto.

## 5. Secuencia de aprovisionamiento y reinicios — puntos 3 y 4

Secuencia propuesta para validar por combinación de firmware OLT y modelo/firmware ONU:

1. Validación, exclusión de operaciones y observación previa.
2. Aplicar y comprobar transporte requerido.
3. Aplicar y comprobar asociaciones OMCI, IP-host, VLAN, ACS y reglas soportadas.
4. Persistir y comprobar configuración mediante los mecanismos disponibles del firmware.
5. Finalizar los cambios sin emitir reinicios automáticos.
6. Consultar la convergencia OMCI mediante lecturas acotadas.
7. Verificar configuración, IP y comunicación ACS por separado.

La política vigente excluye reinicios del aprovisionamiento para todos los modelos. Si se diagnostica un equipo que requiere intervención adicional, informarlo y reservar el reinicio a la acción explícita del operador; no esconderlo dentro del comando del ACS.

Sustituir el bucle actual de `applyAcsUrlWithRetries` por una política según causa:

| Causa | Acción |
| --- | --- |
| Sintaxis, parámetros, permisos o perfil inexistente | Detener; corregir precondición; cero reinicios automáticos |
| Entidad OMCI desconocida o capacidad no soportada | Reportar incompatibilidad; detener requisito o marcar opcional omitido |
| Ya existe | Leer y comparar; aplicar diferencia si está justificada |
| Timeout/desconexión | Resultado indeterminado; reconectar y leer antes de repetir |
| Fallo transitorio OMCI reconocido para esa combinación | Observar y reportar; cualquier recuperación futura debe respetar la política de cero reinicios automáticos |

Un código genérico como 63990 no basta para clasificar un fallo como recuperable. Se elimina `applyAcsUrlWithRetries` y el ACS participa en el bucle normal de comandos, con el mismo pacing y reporte de rechazos. No hay reinicio posterior al éxito ni al error. El reintento CLI de 20200 existente sigue pendiente de la clasificación y validación de contexto de la sección 3.

Conservar el polling de `Config state` después del guardado como observación de convergencia; no utilizarlo para desencadenar reinicios. Los avisos deben describir sincronización pendiente sin afirmar que esta operación reinició la ONU.

## 6. Protección de credenciales — punto 6

Reutilizar y ampliar `utils/redact-olt-cli.ts` en ejecutor, errores, capturas, logs, auditoría y serialización de resultados. El comando ejecutable debe permanecer separado de su representación de diagnóstico; evitar incluir el comando original en incidencias.

Cubrir contraseñas con y sin comillas, credenciales dentro de URL, ecos de CLI y errores externos que contengan los secretos conocidos de la operación. Aplicar redacción y sustitución explícita de esos secretos antes de persistir o responder. Evitar registrar excepciones originales si conservan datos sensibles.

En BullMQ transportar referencias de credenciales, no contraseña, comando completo ni URL con secretos. Guardar datos temporales indispensables cifrados en el mecanismo seguro del proyecto, con ámbito de tenant/operación, caducidad, borrado al finalizar y plazo suficiente para recuperación tras caída. Si ese mecanismo no existe, implementarlo antes de habilitar trabajos con credenciales transitorias.

No modificar silenciosamente la contraseña utilizada para autenticar: redactar solo su copia de diagnóstico. Añadir pruebas con valores ficticios y comprobar que nunca aparecen en ninguna salida persistida o pública.

## 7. Verificación por capas — punto 7

Separar las siguientes comprobaciones y conservar su evidencia:

| Capa | Confirmación requerida |
| --- | --- |
| Configuración OLT | Lectura posterior coincide con el plan de transporte, binds, filtros y ACS donde sea consultable |
| Persistencia | `write` sin rechazo y evidencia de guardado/startup cuando el firmware la permita |
| Estado OMCI | Fase operativa y `Config state` satisfactorio, posterior a los cambios |
| IP de gestión | IP-host de gestión con dirección válida y coherente con la red seleccionada |
| ACS | Identidad correcta de ONU y un Inform reciente en la instancia ACS de destino, posterior al inicio del cambio |

Reutilizar `getOnuIpHost`, `getOnuTr069MgmtInfo` y la integración GenieACS existentes. Correlacionar tenant, serial e identidad del dispositivo; un registro viejo o un Inform en otro ACS no verifica la operación. No usar ping como prueba de TR-069 ni asumir que observar una IP valida todos los filtros.

Una consulta rechazada, respuesta no parseable o transporte interrumpido produce evidencia desconocida con incidencia visible. Limitar consultas y duración; no borrar un fallo de lectura previo sin registrar qué consulta sí lo resolvió. Si la configuración está confirmada pero no llega el Inform a tiempo, terminar como `applied_unverified` y programar comprobación posterior de solo lectura.

La reconciliación posterior debe actualizar evidencia, no repetir automáticamente todo OMCI ni reiniciar por no haber recibido Inform. Usar el flujo real que gestione la operación; no asumir que `GenieAcsReconciliationService`, actualmente orientado a monitoreo de dispositivos vinculados, ya reaprovisiona el ACS.

## 8. Precondiciones de red y DHCP snooping — punto 9

Implementado: se retiraron las mutaciones de DHCP snooping y se sustituyó el flujo por un plan calculado desde el estado observado. El preflight consulta VLAN, perfil TCONT, VLAN de uplinks registrados y DHCP snooping en modo de solo lectura. Un formato no reconocido permanece desconocido; nunca se utiliza para habilitar políticas globales. La compatibilidad de esos formatos requiere laboratorio por firmware.

Retirar las tres mutaciones globales de `ensureTr069TransportWithSession`. Incorporar un preflight de solo lectura de la red de gestión: VLAN existente, transporte/uplink aplicable y configuración relevante de DHCP snooping conforme al firmware.

Un requisito confirmado ausente debe detener antes de modificar la ONU con un diagnóstico específico. Una capacidad de lectura no soportada debe figurar como desconocida; no justificar un cambio global automático.

Si la instalación necesita administrar DHCP snooping, hacerlo en una operación independiente de mantenimiento de OLT: estado observado, diferencias, impacto compartido, persistencia y reversión propios. Su sintaxis y necesidad se validarán en la red concreta. No añadir esta operación como efecto secundario de un botón de ONU.

## 9. Ejecución asíncrona, tiempos y concurrencia — punto 10

Crear una cola `olt-tr069` con BullMQ, ya presente en el backend. Añadir entidad de operación, migración de tenant, productor y processor dentro del módulo OLT.

Contrato propuesto:

- `POST /olt/onus/:id/tr069-profile` y `POST /olt/onus/:id/tr069-acs`: validar y crear operación; responder `202` con `operationId`, estado y recurso de consulta.
- `GET /olt/onus/:id/tr069-operations/:operationId`: devolver progreso, resultado y evidencia sanitizada, comprobando tenant y permisos.
- Doble clic con la misma clave de idempotencia y solicitud equivalente: devolver la operación existente. Si cambia el contenido, rechazar el conflicto.

Persistir operación e intención de encolado de forma recuperable mediante outbox o reconciliación de pendientes. Un fallo de Redis no debe perder una operación confirmada en base de datos. El worker registra etapa y progreso; al recuperarse de una caída relee el equipo antes de continuar. No asumir ejecución exactamente una vez.

Reutilizar `withOltTelnetLock` para las sesiones físicas y añadir exclusión persistente por ONU para toda la operación. Asegurar que rutas manuales y reconciliadores respeten la misma exclusión. Si el worker corre en otro proceso, reemplazar la exclusión física en memoria por una exclusión compartida por todos los clientes del mismo equipo, con lease renovable y comprobación de propiedad antes de mutar. Identificar la OLT física, no solo una fila duplicada.

Durante esperas largas se puede cerrar la sesión y liberar la exclusión física, conservando la exclusión de operación sobre la ONU; cada consulta posterior abre sesión bajo la exclusión física. No liberar el lock y compartir simultáneamente una sesión abierta. Las lecturas internas de una sesión ya bloqueada no deben volver a adquirir el mismo mutex.

Crear una política temporal común para ambos flujos:

- Pacing mínimo por categoría y combinación de firmware/capacidad, sin pausas universales de seis segundos.
- Valores iniciales conservadores y calibración en laboratorio; no reducirlos solo para evitar el timeout HTTP.
- Reloj monotónico y deadline de operación; tiempo máximo de comando limitado por el presupuesto restante.
- Incluir conexión, autenticación, lecturas, backoff, reinicio, guardado y compensación en el presupuesto.
- Registrar por separado espera de cola/lock y tiempo efectivo de ejecución, con límites para ambos.
- Sondeo y backoff acotados, con temporizadores cancelables y sin prometer que 45 segundos de pausas equivalen a 45 segundos totales.
- Al agotar presupuesto, detener mutaciones y conservar estado parcial o indeterminado; una continuación de solo lectura puede resolverlo posteriormente.

Actualizar `ApplyTr069ProfileModal.tsx` y sus pruebas para seguir la operación, distinguir pendiente/parcial/aplicada sin verificar/verificada y evitar el mensaje de éxito al recibir `202`. Conservar el seguimiento al cerrar el modal y recuperarlo al consultar de nuevo la ONU. Desplegar API y consumidor de forma coordinada o versionada; el cliente actual interpreta una respuesta HTTP satisfactoria como operación terminada.

## 10. Archivos y orden de implementación

Rutas relativas a `sumtech-backend/`, salvo frontend y emulador indicados.

| Fase | Cambios principales | Dependencia y salida verificable |
| --- | --- | --- |
| A | `utils/redact-olt-cli.ts`, llamadas de log/error del flujo TR-069 y pruebas de secretos | Primera corrección; elimina exposición antes de ampliar diagnósticos |
| B | `ports/tr069-provisioning.types.ts` nuevo; `olt-driver.port.ts`; servicios, auditoría y migraciones necesarias | Contrato explícito con adaptación de otros drivers y consumidores |
| C | `zte-telnet-session.ts`, `zte-command-executor.ts` nuevo, parsers y pruebas de sockets | Respuestas y contexto comprobables; timeout no se confunde con rechazo |
| D | `zte-c320-tr069-state.ts` nuevo, generadores y fixtures de lectura | Plan calculado, migración de VLAN y compensación verificables |
| E | `zte-c320-tr069.ts`, `zte-c320.driver.ts` | Ambos flujos usan ejecutor, política de recuperación y verificación; elimina DHCP global |
| F | Entidad/servicio/processor de operaciones nuevos, `olt.module.ts`, controlador, locks, DB y cola | Ejecución durable, presupuestos y recuperación tras caída |
| G | `onu-management.service.ts`, presentación y pruebas frontend | Estado, versiones, auditoría y API coherentes de extremo a extremo |
| H | Emulador, pruebas de integración, laboratorio y documentación | Evidencia por firmware/modelo y activación gradual |

Preparar el contrato de F y G antes de activar endpoints asíncronos. Ninguna fase intermedia debe exponer una combinación de API nueva y cliente incompatible. Usar una opción de activación por OLT para el nuevo flujo durante la transición.

La documentación `onu-tr069-provisioning-zte-c320.md` contiene secuencias históricas diferentes del generador actual. Mantenerlas como antecedentes fechados y añadir una matriz de secuencias validadas; no copiar instrucciones históricas al nuevo flujo sin verificar.

## 11. Pruebas requeridas

Usar reloj y delays inyectables. Los mocks de CLI deben modelar modos y estado, no devolver éxito para cualquier comando.

| Caso | Resultado esperado |
| --- | --- |
| Rechazo de entrada a configuración o gestión ONU | Se detienen comandos dependientes y no hay falso éxito |
| GEM rechazado o `write` rechazado | Resultado fallido/parcial con etapa y persistencia correctas |
| 20200 por modo equivocado y por sintaxis no soportada | Recuperación comprobada solo en el primer caso; cero bucles ciegos |
| Ya existe con valor correcto y con valor diferente | Omitir en el primero; reconciliar diferencia en el segundo |
| Eliminación de objeto ausente frente a falta de permisos | Ausencia tolerada; permisos reportados como fallo |
| Timeout después de aplicar el comando | Reconectar, observar y evitar duplicar mutación/reinicio |
| ACS permanentemente rechazado | Sin seis reinicios ni resultado completo |
| Reinicio aceptado, rechazado o confirmación perdida | Evidencia correcta y presupuesto conservado |
| ONU en `syncMib`, luego operativa; ONU que no vuelve | Sin comandos OMCI durante recuperación; salida acotada |
| Migración 46 → 50 y fallo a mitad | Borrar VLAN antigua real; compensar o reportar diferencias restantes |
| Falta de perfil o conflicto con canal 2 ajeno | Fallar preflight sin destruir otro servicio |
| Lectura inválida, no soportada o sin `configState` | Desconocido visible; no éxito silencioso |
| IP válida pero sin Inform; registro ACS antiguo o de otra ONU | Configuración aplicada sin verificación operativa falsa |
| Inform nuevo del dispositivo en el ACS de destino | Resultado verificado con identidad y fecha |
| Dos clics, reentrega de job o caída del worker | Misma operación, presupuestos persistentes y relectura previa |
| Contención de OLT y dos procesos | Exclusión efectiva, sin deadlocks y sin mutaciones tras perder lease |
| Credenciales en comando, URL, eco y excepción | Ninguna fuga en logs, auditoría, DB, Redis ni API |
| Configuración parcial o solo verificación pendiente | Versiones y auditoría coherentes; sin reaplicación completa automática |
| Operación TR-069 sobre ONU con Internet | Sin cambios a recursos de Internet ni DHCP global; evidencia antes/después |

Actualizar pruebas existentes que hoy exigen seis reinicios o éxito con advertencia ante cualquier rechazo. Extender `sumtech-olt-emulator/src/engines/zte-c320.engine.js` con cambios de modo, errores, configuración persistida y estados de reinicio; el emulador valida el protocolo de software, no compatibilidad OMCI real.

Ejecutar las suites enfocadas de sesión, driver, parsers, ejecutor, servicio, operaciones y frontend; después las regresiones afectadas de autorización, WAN, auditoría y reconciliación. Ejecutar `npm run build` en backend y las comprobaciones establecidas del frontend. No añadir pruebas de producción que reinicien ONUs automáticamente.

## 12. Laboratorio, despliegue y cierre

Validar una ONU de laboratorio por combinación disponible de firmware OLT y modelo/firmware ONU. Incluir alta de gestión, reaplicación equivalente, cambio de VLAN, cambio aislado de ACS, rechazo permanente y recuperación tras desconexión. Capturar comandos/tiempos sanitizados, estado antes/después, persistencia, IP de gestión e Inform en ACS; comprobar continuidad del servicio de Internet conforme a la ventana de reinicio prevista.

Activar primero en laboratorio, después en una OLT seleccionada y finalmente de forma gradual. Observar tasa de resultados parciales, duración por etapa, errores de parser, contención de locks, reinicios por operación y verificación ACS. La habilitación de recuperaciones específicas exige su propia evidencia; no extrapolar entre modelos.

Para revertir, detener nuevas operaciones del flujo nuevo y resolver o marcar las activas antes de cambiar de ejecutor. Conservar resultados y evidencias. Una reversión de software no restaura la configuración de una ONU: usar la compensación registrada y releer; no ejecutar borrados masivos ni reautorizar Internet. Evitar volver a habilitar el bucle antiguo de reinicios como mecanismo de recuperación.

Cierre de implementación: los diez criterios de la sección 1 pasan, ambos botones usan la misma infraestructura, API/DB/auditoría reflejan el mismo resultado, las operaciones sobreviven a una caída del worker sin duplicar reinicios y existe evidencia de laboratorio para las combinaciones habilitadas. Las capacidades sin validar permanecen explícitamente identificadas como tales.
