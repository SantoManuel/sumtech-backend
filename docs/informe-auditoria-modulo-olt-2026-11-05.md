Informe de auditoría del módulo OLT — duplicación y código sin consumidores

Fecha: 2026-11-05. Alcance principal: `sumtech-backend/src/modules/olt`. Se revisaron también sus referencias desde el resto del backend y los consumidores TR-069 del frontend.

El módulo sí contiene código duplicado y funciones sin llamadas de producción en el repositorio. Los hallazgos más importantes son cinco funciones o métodos sin consumidores de producción identificados, una constante de reinicio utilizada solamente por pruebas, cuatro grupos de duplicación exacta con lógica activa y dos duplicaciones de lógica adicionales. También coexisten dos orquestaciones TR-069 con criterios distintos para guardar el resultado.

Esto no significa que todo archivo sin llamadas directas sea eliminable. Los controladores HTTP, los cron, los hooks de Nest y los métodos de drivers utilizados a través de interfaces tienen entradas dinámicas. Se excluyeron de la lista de eliminación automática.

**Cobertura y método.**

| Medida | Resultado |
|---|---:|
| Archivos TypeScript del módulo | 97 |
| Archivos de producción del módulo | 70 |
| Archivos de pruebas | 26 |
| Archivo de fixtures de apoyo | 1 |
| Líneas físicas de producción, incluidos comentarios y espacios | 14.742 |
| Archivos del backend examinados para resolver referencias | 791 |
| Grupos con cuerpos léxicamente idénticos, ignorando comentarios y espacios | 15 |

El análisis usó el AST y el resolvedor de símbolos de TypeScript, búsquedas con `rg` y revisión manual de rutas, registros de proveedores, interfaces y decoradores. Las referencias en pruebas se contabilizaron por separado. Los cuerpos comparados conservan nombres de identificadores y literales; el número 15 no mide porcentaje de código repetido ni demuestra equivalencia de funciones con dependencias diferentes.

De esos 15 grupos, cuatro corresponden a lógica activa compartida y once a métodos de drivers que rechazan explícitamente operaciones no implementadas. Las duplicaciones semánticas descritas más adelante se revisaron manualmente y no forman parte de esa cifra automática.

No se accedió a OLTs, bases de datos ni servicios externos. Este informe no demuestra qué endpoints consumen integraciones ajenas al repositorio ni qué trabajos históricos existen en Redis o PostgreSQL.

**Funciones y métodos sin llamadas de producción identificadas.**

| ID | Símbolo y ubicación | Referencias encontradas | Evaluación y acción propuesta |
|---|---|---|---|
| U1 | [`getTr069PacingDelay()`](../src/modules/olt/drivers/zte-c320-tr069.ts:15) | Sin llamadas de producción ni pruebas | Función exportada huérfana. El ejecutor actual aplica sus propias pausas. Eliminarla o convertirla en la fuente efectiva del pacing, evitando mantener dos definiciones. |
| U2 | [`ZteC320Driver.parseOnuRunningConfig()`](../src/modules/olt/drivers/zte-c320.driver.ts:304) | Dos referencias en pruebas; ninguna en producción | Wrapper conservado expresamente para las pruebas del driver. La función real del parser sí se usa en producción. Mover las pruebas al parser y retirar solamente el wrapper si se decide reducir la superficie pública. |
| U3 | [`OltPartialOperationService.listPending()`](../src/modules/olt/services/olt-partial-operation.service.ts:29) | Dos referencias en pruebas; ninguna en producción | Consulta implementada pero sin controlador, cron o servicio consumidor. Decidir si se conecta a una recuperación real o se elimina. |
| U4 | [`OltPartialOperationService.reconcile()`](../src/modules/olt/services/olt-partial-operation.service.ts:37) | Tres referencias en pruebas; ninguna en producción | La reconciliación de operaciones parciales no está conectada. No confundirla con la reconciliación WAN, que sí tiene consumidores. |
| U5 | [`OnuTr069OperationsService.create()`](../src/modules/olt/services/onu-tr069-operations.service.ts:42) | Referencias en pruebas; ninguna llamada de producción | La entrada que crea nuevas operaciones TR-069 en cola quedó desconectada. Los POST actuales llaman directamente a `OnuManagementService`. Esto no permite eliminar indiscriminadamente el resto de la infraestructura de cola. |

Estas cinco entradas tienen confianza alta respecto de la ausencia de llamadas en el código revisado. No se afirma que sea imposible invocarlas por reflexión o desde código externo no disponible.

Además, [`REBOOT_ONU_SENTINEL`](../src/modules/olt/drivers/zte-c320-provisioning-scripts.ts:299) se conserva como constante exportada y se reexporta desde [`zte-c320.driver.ts`](../src/modules/olt/drivers/zte-c320.driver.ts:88). Sus referencias efectivas son tres comprobaciones negativas en pruebas. Ningún generador actual lo introduce ni un ejecutor lo necesita para aprovisionar. Es un residuo de la estrategia anterior de reinicio; su comentario describe un mecanismo que ya no está conectado. Se puede sustituir en las pruebas por una comprobación independiente que prohíba comandos o sentinels de reinicio.

**La cola TR-069 tiene una entrada huérfana, pero conserva actividad registrada.**

Los POST [`tr069-profile` y `tr069-acs`](../src/modules/olt/onu.controller.ts:213) utilizan el servicio directo. No llaman a `OnuTr069OperationsService.create()`.

Sin embargo, [`OltModule`](../src/modules/olt/olt.module.ts:62) todavía registra la cola BullMQ, la entidad de operaciones, el servicio y el processor. También siguen disponibles:

- Los GET de operación más reciente y de operación por identificador, en [`OnuController`](../src/modules/olt/onu.controller.ts:245).
- [`OnuTr069Processor.process()`](../src/modules/olt/services/onu-tr069.processor.ts:11), invocado por BullMQ y no mediante una llamada directa desde el código de negocio.
- [`OnuTr069OperationsService.recover()`](../src/modules/olt/services/onu-tr069-operations.service.ts:190), registrado como cron cada minuto.
- La recuperación de filas `queued`/`running`, su reencolado y las verificaciones posteriores de operaciones `applied_unverified`.

Por tanto, la clasificación correcta es «subsistema parcialmente desconectado del flujo de nuevas solicitudes». Si hay trabajos históricos, los componentes registrados todavía pueden procesarlos. Antes de retirarlos se debe revisar y resolver ese estado; no basta con que el modal haya dejado de consultar operaciones. No se comprobó la existencia de esos registros durante esta auditoría.

**Operaciones parciales: se registran incidencias, pero no existe consumidor de recuperación conectado.**

[`OnuManagementService.recordPartialOperation()`](../src/modules/olt/services/onu-management.service.ts:120) sí llama a `OltPartialOperationService.record()` desde autorización y aplicación TR-069. Por eso el servicio y su entidad no están completamente sin uso.

La desconexión está en la otra mitad: `listPending()` y `reconcile()` solo aparecen consumidos por pruebas. Las incidencias pueden quedar pendientes sin un proceso de este repositorio que utilice esos métodos para consultarlas y reconciliarlas. La solución requiere elegir entre una funcionalidad de recuperación completa o un registro de incidencias con una responsabilidad más limitada.

**Duplicación exacta de lógica activa.**

| ID | Ubicaciones | Duplicación | Recomendación |
|---|---|---|---|
| D1 | [`buildSecurityMgmtCommands()`](../src/modules/olt/drivers/zte-c320-provisioning-scripts.ts:51) y [`buildTr069SecurityMgmtCommands()`](../src/modules/olt/drivers/zte-c320-provisioning-scripts.ts:61) | Mismo cuerpo: misma comprobación `securityMgmtSupported` y mismas reglas 998 y 999 | Usar un constructor compartido. Puede mantenerse un wrapper semántico para TR-069 si ayuda a leer el flujo. Ambas funciones se usan actualmente. |
| D2 | `resolveDriver()` en [`OnuManagementService`](../src/modules/olt/services/onu-management.service.ts:132), [`OltManagementService`](../src/modules/olt/services/olt-management.service.ts:145) y [`OltMonitoringService`](../src/modules/olt/services/olt-monitoring.service.ts:48) | Misma resolución por fabricante y conversión de `UnknownOltVendorError` | Compartir la adaptación de errores en la capa de servicios sin introducir dependencias HTTP innecesarias en el registro de drivers. |
| D3 | `callDriver()` en [`OnuManagementService`](../src/modules/olt/services/onu-management.service.ts:144) y [`OltManagementService`](../src/modules/olt/services/olt-management.service.ts:157) | Misma conversión de `DriverNotImplementedError` a HTTP 501 | Unificar el adaptador de errores. Los dos métodos sí están activos. |
| D4 | `handleIac()` en [`ZteTelnetSession`](../src/modules/olt/drivers/zte-telnet-session.ts:478) y [`HiosoTelnetSession`](../src/modules/olt/drivers/hioso.driver.ts:1039) | Mismo cuerpo de negociación Telnet | Extraer la negociación común; mantener separados el login, los prompts y el resto del comportamiento de cada fabricante. |

Estas duplicaciones no deben resolverse borrando una copia mientras todavía tiene llamadas. La consolidación debe conservar los contratos y la conducta comprobada.

**Duplicaciones semánticas adicionales.**

| ID | Ubicaciones | Hallazgo | Recomendación |
|---|---|---|---|
| D5 | [`OltMonitoringService.resolveOltConnectionParams()`](../src/modules/olt/services/olt-monitoring.service.ts:60) y [`OltConnectionResolverService.resolve()`](../src/modules/olt/services/olt-connection-resolver.service.ts:32) | Repiten la resolución DIRECT/VIA_MIKROTIK, el puerto NAT y el descifrado de credenciales. El servicio central existe, pero monitoreo conserva su implementación local. | Inyectar el resolver central en monitoreo y retirar las dependencias que solo servían a la copia local. Mantener pruebas de DIRECT y VIA_MIKROTIK. |
| D6 | [`verifyOnuTypeProfileWithSession()`](../src/modules/olt/drivers/zte-c320-profiles.ts:57) y [`ensureOnuTypeProfileWithSession()`](../src/modules/olt/drivers/zte-c320-profiles.ts:130) | Repiten lectura y extracción de Max VEIP/Max IPHost, correcciones, manejo de errores, salida de contexto y guardado. | Compartir la inspección y, si se mantiene esa política, la reparación del perfil existente. Conservar separada la decisión de crear un perfil ausente. |

En D6 hay una diferencia relevante: `verifyOnuTypeProfileWithSession()` no se limita a verificar; también puede modificar un perfil ONU compartido. Un refactor debe explicitar esa responsabilidad. No se propone reemplazarla automáticamente por la función `ensure`, porque eso podría cambiar la política de creación de perfiles.

**Dos orquestaciones TR-069 con reglas de resultado diferentes.**

| Camino | Componentes | Criterio de persistencia en el sistema |
|---|---|---|
| Directo, usado por los POST actuales | [`applyTr069Profile()` / `performApplyTr069Profile()`](../src/modules/olt/services/onu-management.service.ts:1337) | Si existe `result.warning`, deja `applyStatus = PENDING` y no avanza `appliedVersion` en esa rama. |
| Cola, todavía registrada | [`prepareTr069Operation()` / `executePreparedTr069()`](../src/modules/olt/services/onu-management.service.ts:1341) y [`OnuTr069OperationsService.process()`](../src/modules/olt/services/onu-tr069-operations.service.ts:101) | Marca `APPLIED` cuando configuración y persistencia están confirmadas, aunque la comunicación ACS siga sin verificar. |

Los dos caminos comparten el driver, pero repiten parte de la preparación, la ejecución y el guardado del resultado. Ya existe una divergencia observable en el código: el [driver TR-069](../src/modules/olt/drivers/zte-c320-tr069.ts:24) devuelve normalmente `applied_unverified` y añade un aviso de comunicación ACS pendiente tras aplicar y guardar. El camino directo trata ese aviso como motivo para mantener la configuración pendiente, mientras que la cola distingue configuración aplicada de ACS verificado.

Esta es la duplicación funcional de mayor prioridad: puede explicar que el sistema muestre un estado pendiente aunque la configuración se haya confirmado en la OLT. No demuestra por sí misma que una ejecución concreta haya aplicado el perfil, ni explica todos los posibles fallos de preflight o CLI.

La recomendación es tener un único resultado de dominio que separe configuración, guardado y comunicación ACS. El flujo directo debe consumir ese resultado. La infraestructura de cola puede retirarse después de resolver trabajos históricos, si ya no forma parte del producto deseado.

**Elementos que no deben clasificarse como código muerto solo por una búsqueda de llamadas.**

- Los métodos de `OltController`, `OnuController` y `OnuWebProxyController` se ejecutan por rutas HTTP.
- Los métodos `@Cron` de monitoreo, reconciliación CPE y recuperación TR-069 se invocan por el scheduler.
- `OltIoLockService.onModuleInit()` y `onModuleDestroy()` se invocan por el ciclo de vida de Nest; instalan y retiran el bloqueo compartido.
- Los métodos de drivers se invocan normalmente a través de `IOltDriver`, resuelto por `OltDriverRegistry`. Una referencia al miembro de la interfaz no siempre figura como llamada directa al miembro de la clase concreta.
- Los métodos de `ZteTelnetSession` se utilizan también a través de `ZteSessionLike`.
- Los once grupos duplicados de operaciones no implementadas en Huawei/HSGQ y algunos métodos HiOSO/ZTE son adaptadores que lanzan un error explícito. Su repetición puede simplificarse, pero no son dos implementaciones reales de aprovisionamiento ni deben eliminarse dejando incompleto el contrato del driver.
- La función libre `parseOnuRunningConfig()` sí está activa, aunque el wrapper del driver U2 no tenga consumidores de producción.

Hay otra superficie pública heredada que merece revisión: `IOltDriver.generateTr069ManagementScript()` sigue siendo parte del contrato y se implementa en los drivers, pero no se encontró una llamada de producción a ese método del driver. El planificador importa directamente la función libre del mismo nombre, que sí está activa. Retirar el método exigiría actualizar el contrato, los fabricantes y sus pruebas; no equivale a borrar el generador real.

**Declaraciones sin uso detectadas por el compilador.**

Al activar `noUnusedLocals` y `noUnusedParameters`, TypeScript informó 110 diagnósticos dentro del módulo, incluidas sus pruebas. La mayoría corresponden a parámetros de métodos no implementados. Esa cifra no representa 110 funciones muertas.

Entre los casos de limpieza concreta están:

| Ubicación | Declaración |
|---|---|
| [`onu.controller.ts`](../src/modules/olt/onu.controller.ts:11) | Importación `HttpCode`. |
| [`olt-management.service.ts`](../src/modules/olt/services/olt-management.service.ts:13) | Importación `decryptCredential`. |
| [`zte-c320-profiles.ts`](../src/modules/olt/drivers/zte-c320-profiles.ts:2) | Importaciones `DiscoveredTcontProfile` y `DiscoveredTrafficProfile`. |
| [`onu-management.service.ts`](../src/modules/olt/services/onu-management.service.ts:107) | Inyección `networkAccessRepository` sin lecturas. |
| [`onu-management.service.ts`](../src/modules/olt/services/onu-management.service.ts:115) | Inyección `tenantContext` sin lecturas. |
| [`hioso.driver.ts`](../src/modules/olt/drivers/hioso.driver.ts:41) | Propiedad `logger` sin uso y variable `freeMatch` en la lectura de salud. |
| [`huawei-ma5800.driver.ts`](../src/modules/olt/drivers/huawei-ma5800.driver.ts:32) y [`hsgq.driver.ts`](../src/modules/olt/drivers/hsgq.driver.ts:31) | Propiedades `logger` sin uso. |

Eliminar una inyección sin uso de una clase no autoriza a eliminar su entidad o proveedor de todo el módulo: otros servicios pueden seguir necesitándolos.

**Hallazgo adyacente en el frontend.**

[`useTr069Operation.ts`](../../sumtech-frontend/src/components/modules/network/useTr069Operation.ts:16) quedó sin importaciones ni consumidores identificados en `sumtech-frontend/src` después de simplificar el modal. Su hook, las etiquetas de estados y el tipo de vista de operación forman un archivo huérfano del flujo actual. Es un candidato de limpieza independiente del backend; retirarlo no exige eliminar inmediatamente las tablas o trabajos históricos.

**Estado de validación observado.**

La comprobación normal de TypeScript del backend terminó correctamente. La comprobación adicional con las dos opciones de elementos sin uso terminó con diagnósticos; esas opciones no están activadas en la configuración normal.

Se ejecutaron las 26 suites del módulo OLT:

| Archivo | Pruebas fallidas |
|---|---:|
| `drivers/zte-c320.driver.spec.ts` | 28 |
| `drivers/zte-c320-tr069.spec.ts` | 13 |
| `drivers/zte-c320-tr069.integration.spec.ts` | 4 |
| `drivers/hioso.driver.spec.ts` | 1 |
| Total | 46 |

Resultado global: **633 pruebas aprobadas y 46 fallidas; 22 suites aprobadas y 4 fallidas**.

Se comprobó que la fixture TR-069 no devuelve el nuevo catálogo `show traffic-profile` ni incluye el límite de bajada en la instantánea que considera equivalente. Esto provoca fallos tempranos y diferencias en el plan esperado. También hay pruebas heredadas del driver que esperan el flujo anterior de mejor esfuerzo. La prueba HiOSO compara un objeto de capacidades que no incluye los campos `onuReboot: false` y `onuFactoryReset: false` presentes en el resultado actual. No se atribuyen automáticamente los 46 fallos a una sola causa; requieren actualización o diagnóstico por caso.

**Orden propuesto para una futura limpieza.**

1. Resolver el desacuerdo entre configuración aplicada y ACS pendiente. Mantener un contrato de resultado común para el flujo directo.
2. Corregir las fixtures y expectativas que describen comportamientos retirados, y diagnosticar el resto de los fallos hasta disponer de una base de pruebas fiable.
3. Retirar U1, las importaciones y las inyecciones sin uso. Revisar el wrapper U2 y la constante de reinicio junto con sus pruebas.
4. Decidir el destino de U3/U4: conectar una recuperación real o reducir explícitamente el registro de operaciones parciales.
5. Retirar la entrada de cola desconectada y el hook frontend; después, revisar trabajos históricos antes de desmontar cron, processor, rutas de consulta y persistencia.
6. Consolidar D1, D2, D3 y D5. Mantener el enrutamiento por fabricante y la resolución DIRECT/VIA_MIKROTIK.
7. Consolidar D4 y D6 con pruebas que preserven negociación Telnet, cambios de contexto y políticas de perfiles compartidos.
8. Evaluar al final la reducción de los stubs de fabricantes y de métodos heredados del contrato, porque tienen mayor alcance de compatibilidad.

Estas son recomendaciones; durante esta auditoría no se eliminó ni modificó código funcional.

**Evidencia reproducible.**

El script de análisis está en [`scratch/audit-olt-static.cjs`](../../scratch/audit-olt-static.cjs), y el detalle de símbolos y duplicados en [`scratch/audit-olt-static.json`](../../scratch/audit-olt-static.json). Es una herramienta de auditoría, no una dependencia del producto. Sus resultados necesitan la revisión de entradas dinámicas explicada arriba.

Los resultados de Jest se guardaron en [`scratch/olt-jest-audit.json`](../../scratch/olt-jest-audit.json) y [`scratch/olt-jest-audit.txt`](../../scratch/olt-jest-audit.txt). Los diagnósticos adicionales están en [`scratch/olt-unused-diagnostics.txt`](../../scratch/olt-unused-diagnostics.txt).

Desde la raíz del workspace:

```powershell
& 'C:/Program Files/nodejs/node.exe' scratch/audit-olt-static.cjs
```

Desde `sumtech-backend`:

```powershell
& 'C:/Program Files/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false
& 'C:/Program Files/nodejs/node.exe' node_modules/typescript/bin/tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters --pretty false
& 'C:/Program Files/nodejs/node.exe' node_modules/jest/bin/jest.js --runInBand --silent --testPathPattern=modules/olt
```
