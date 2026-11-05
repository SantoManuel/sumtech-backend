# Implementación TR-069 C320 — 2026-11-04

Estado: cambios de software implementados localmente, sin despliegue. A–G cuentan con código y pruebas; H incluye integración sintética y documentación, con validación externa pendiente.

## Cambios entregados

| Fase | Implementación |
| --- | --- |
| A | `redact-olt-cli.ts` protege contraseñas, usuarios, credenciales en URL, parámetros sensibles y secretos conocidos. Se retiraron credenciales predeterminadas del modal y del resolvedor del backend. Los parámetros de trabajo se cifran con AES-256-GCM y no viajan en Redis. |
| B | `tr069-provisioning.types.ts` define resultado, estado de configuración/persistencia, evidencias por capa, incidencias y tiempos. Los fallos requeridos devuelven `ok:false`; una configuración guardada aún sin Inform queda `applied_unverified`. |
| C | `zte-command-executor.ts` valida respuestas y modos reales expuestos por `executeCommandDetailed`. El rechazo 20200 no se repite a ciegas; un timeout invalida la sesión para nuevas mutaciones. La limpieza no oculta el fallo original. |
| D | `zte-c320-tr069-state.ts` exige una lectura completa e identidad de ONU coincidente, calcula diferencias, conserva Internet y rechaza recursos de gestión con dueño incierto. La migración elimina las VLAN antiguas observadas y compensa cambios reversibles. La vista previa usa el mismo plan observado y oculta credenciales. |
| E | Aplicar perfil y actualizar ACS usan el flujo común. Se verifican requisitos, contexto, GEM, configuración posterior y guardado. Cero reinicios automáticos; cero mutaciones DHCP globales; ningún perfil global se crea por esta operación. |
| F | Operaciones persistidas en PostgreSQL y cola `olt-tr069`, worker con contexto de tenant, idempotencia, exclusión de ONU y lock físico compartido sobre la conexión PostgreSQL de plataforma. La fila persistida sirve de outbox recuperable cuando Redis falla. |
| G | API asíncrona, progreso y resultado consultables, versiones protegidas contra solicitudes obsoletas, auditoría con resultado explícito y panel que distingue cola, ejecución, fallo, parcial, aplicada sin verificar y verificada. Cerrar el panel conserva la operación en el servidor. |
| H | Modelo CLI estricto opcional en el emulador, integración con el parser de sesión Telnet real en memoria, pruebas de migración/compensación, fallos, secretos, cola, tenant y seguimiento UI. Las pruebas sintéticas no certifican OMCI de un modelo real. |

## Reglas de ejecución

- El reinicio queda reservado a la acción manual independiente. El aprovisionamiento rechaza comandos de reinicio y cambios de DHCP snooping.
- El ACS y las asociaciones ya equivalentes se omiten. «Ya existe» no se utiliza como prueba de equivalencia: una carrera o conflicto se reporta.
- La lectura completa debe contener los bloques esperados y su cierre. Una lectura vacía, truncada o no compatible detiene las mutaciones.
- El perfil TCONT debe existir. La VLAN debe poder comprobarse; el preflight nunca crea perfiles ni cambia uplinks/snooping. Una consulta opcional no soportada queda desconocida.
- Si el canal 2 ya existe sin evidencia de que sea de gestión TR-069, se exige revisión manual. Esto puede detener también la recuperación de un intento interrumpido que solo alcanzó a crear transporte; no se adopta un canal de dueño incierto.
- La compensación restaura valores anteriores con inversas conocidas. No se promete revertir automáticamente entidades nuevas cuya eliminación no esté validada. El resultado permanece parcial y enumera la compensación intentada o inconclusa.
- Las transiciones de etapa se guardan antes de continuar. La sesión tiene presupuesto CLI de 240 segundos y el worker propaga un presupuesto de ejecución de 300 segundos; se descuentan esperas y se acotan comandos y conexión al tiempo restante. El lock físico espera como máximo 30 segundos. No se usa un timeout HTTP para dejar comandos mutantes ejecutándose fuera del seguimiento.
- La espera en cola expira a los 30 minutos. La limpieza periódica elimina el payload cifrado de solicitudes expiradas, incluso cuando Redis no esté disponible. Al terminar se elimina el payload en la misma transacción que guarda el resultado. La limpieza física depende del backend, su cron y un tenant activo; la comprobación de caducidad impide utilizar un payload vencido aunque su limpieza se retrase.
- Una reentrega comienza con lectura nueva, conserva la versión solicitada y no reinicia la ONU. La identidad y ubicación de la ONU, versión deseada y habilitación de OLT se vuelven a comprobar al ejecutar.
- La reconciliación posterior es de solo lectura, con diez comprobaciones y ventana máxima de quince minutos. No reaplica OMCI por falta de Inform.
- `verified` requiere configuración/persistencia confirmadas, convergencia OMCI, IP de la red de gestión y un Inform posterior al cambio, con serial exacto y tag del tenant en el ACS de destino. El guardado se acredita por aceptación CLI de `write`, sin prueba de ciclo eléctrico.

## API y persistencia

- `POST /olt/onus/:id/tr069-profile` y `POST /olt/onus/:id/tr069-acs`: `202` con `operationId`, `status` y `statusUrl`. El encabezado `Idempotency-Key` permite recuperar la misma solicitud; reutilizarlo con otro contenido produce conflicto.
- `GET /olt/onus/:id/tr069-operations/latest`: recupera la operación más reciente al abrir el panel.
- `GET /olt/onus/:id/tr069-operations/:operationId`: devuelve progreso y evidencias sanitizadas. Los guards verifican permisos de la ONU y los repositorios usan el tenant activo.
- `107_onu_tr069_operations.sql` crea la tabla y las restricciones de idempotencia/operación activa. La entidad está registrada en la configuración de DataSource compartida por tenants y en `OltModule`.
- La versión deseada se reserva una sola vez por solicitud. Solo la configuración y persistencia confirmadas avanzan `appliedVersion`. Los fallos conservan la versión aplicada anterior y registran error. El estado ACS no modifica el estado de configuración WAN del cliente.
- Los locks de sesión PostgreSQL usan el endpoint configurado (`ruta/host/puerto`), no el UUID de la fila OLT. Las escrituras TR-069 comprueban que la conexión del lock siga disponible antes de cada comando. Las rutas alternativas hacia un mismo equipo deben normalizarse en el catálogo; no se descubre automáticamente que dos rutas distintas corresponden al mismo hardware.

## Configuración y preparación del despliegue

1. Aplicar la migración 107 en una base de pruebas de tenant y comprobar sus índices, FK y restricciones. Después incorporarla al procedimiento habitual de migración de tenants; no se ejecutó aquí contra ninguna base externa.
2. Configurar Redis según la configuración BullMQ existente y asegurar que worker, productor y cron usen las mismas bases de plataforma y tenant.
3. Conservar `COMPANY_SECRETS_ENCRYPTION_KEY`, ya utilizada por el proyecto. Debe decodificar a 32 bytes. No rotarla improvisadamente: también protege otros secretos. Es obligatoria para persistir estas solicitudes.
4. Configurar `GENIEACS_CWMP_URL` con el endpoint CWMP atendido por la instancia NBI configurada. Si no coincide con el destino solicitado, el resultado permanece sin verificar.
5. Mantener `TR069_PROVISIONING_OLT_ALLOWLIST` vacío hasta validar una OLT piloto. Después incluir sus UUID separados por comas. `*` habilita todas las OLT y solo debe utilizarse tras validar las combinaciones correspondientes.
6. Desplegar backend y frontend coordinadamente: el cliente anterior interpreta una respuesta HTTP satisfactoria como operación terminada y no comprende el contrato `202`.
7. Probar migración, repetición equivalente, rechazo permanente, recuperación tras caída y continuidad de Internet en laboratorio antes de ampliar la lista de OLT habilitadas.

Para retirar la habilitación, vaciar la lista y detener nuevas solicitudes. Los trabajos aún no ejecutados vuelven a comprobarla. Esperar o resolver las operaciones en curso antes de revertir software; no borrar masivamente recursos ni reautorizar Internet. Conservar las operaciones y evidencias para diagnosticar estados parciales.

## Validación automatizada

Se ejecutaron pruebas unitarias del ejecutor, parsers/plan, redacción, servicio de operaciones, worker, locks y servicios existentes, además de integración del modelo CLI con `ZteTelnetSession`. Se sustituyeron los tests antiguos que exigían éxito ante cualquier rechazo y reinicios repetidos por escenarios con lectura de estado, fallos y compensación.

La regresión completa del módulo OLT registra 654 pruebas aprobadas y una prueba preexistente de HiOSO fallida: la expectativa de capacidades no incluye `onuReboot:false` y `onuFactoryReset:false`, campos ya devueltos antes de estos cambios. No se modificaron ese driver ni su prueba. El resultado JSON se conserva en `scratch/tr069-validation-20261104.json`, relativo al workspace.

Backend: compilación Nest aprobada. Frontend: compilación Next.js, lint y comprobación de tipos aprobados; 15 pruebas del modal aprobadas. Cubren `202`, recuperación de operación parcial, resultado aplicado sin verificar, rechazo de `202` sin identificador y compatibilidad con respuesta síncrona durante la transición.

El buscador Python de la habilidad UI no pudo ejecutarse en este entorno. Se aplicaron las pautas básicas de feedback de carga, estados explícitos y accesibilidad de la habilidad, manteniendo el diseño existente.

## Validación externa pendiente

- Ejecutar la migración y verificar transacciones, índices, recuperación de Redis y exclusión real con dos procesos contra PostgreSQL/Redis de laboratorio. Las pruebas actuales de repositorios y locks usan dobles; no sustituyen esa comprobación.
- Capturar y validar el formato real de `show running-config`, prompts, VLAN, snooping, IP-host y aceptación de `write` por firmware OLT.
- Validar OMCI, cambio de VLAN y compensación por modelo/firmware ONU, sin reinicios automáticos y comprobando el servicio de Internet.
- Confirmar Inform, identidad, tag de tenant y correspondencia NBI/CWMP con una instancia ACS de laboratorio.
- Realizar despliegue piloto y ampliación gradual. Nada de esto se ejecutó contra producción durante esta implementación.
