# TR-069 en ONUs ZTE C320: diagnóstico y solución real (2026-10-20)

Caso de referencia: ONU Huawei HG8546M, serial `CMDCDD4D131E`, OLT `OLT_Tabara_Abajo`
(ZTE ZXA10 C320, `gpon-olt_1/2/15`, onuId `1`), nodo `Nodo_Tabara_Abajo`. SmartOLT
lograba comunicación TR-069 con esta ONU; Sumtech no. Este documento registra las
3 causas raíz reales encontradas y la solución aplicada, para poder reproducirla en
otras ONUs/nodos sin repetir toda la investigación.

## Resumen para quien solo quiere la respuesta rápida

Autorizar una ONU con TR-069 desde la GUI de Sumtech **hoy** provisiona el internet
del cliente correctamente, pero **NO** deja la ONU hablando con GenieACS. Faltan 3
cosas que el código actual no hace (ver "Qué pasa si autorizas desde la GUI" más abajo).

## Causa raíz 1 — Al driver le falta la mitad de la configuración OMCI

`zte-c320.driver.ts` → `generateAuthorizationScript()` genera **un solo** camino de
datos GPON (1 tcont, 1 gemport, 1 service-port) para la VLAN de servicio/internet.
Para que el ONT pueda levantar TR-069, hace falta un **segundo** camino de datos
dedicado a la VLAN de gestión, más todo el "cableado" interno OMCI que conecta ese
camino con el VEIP (interfaz virtual que usa el ONT para TR-069):

```
# Camino de datos (fuera de pon-onu-mng), un service-port por VLAN:
tcont 2 profile <perfil-voip-o-mgmt>
gemport 2 tcont 2
service-port 2 vport 2 user-vlan <vlan-tr069> vlan <vlan-tr069>

# Dentro de "pon-onu-mng <iface>" (gestión OMCI remota):
flow 2 switch switch_0/1
flow mode 2 tag-filter vlan-filter untag-filter discard
flow 2 pri 0 vlan <vlan-tr069>
gemport 2 flow 2
switchport-bind switch_0/1 iphost 2
ip-host 2 dhcp-enable enable
vlan-filter-mode iphost 2 tag-filter vlan-filter untag-filter discard
vlan-filter iphost 2 pri 0 vlan <vlan-tr069>
veip 1 port udp 1232 host 2
```

Sin este bloque, `tr069-mgmt 1 acs <url>` puede aceptarse en la OLT pero el ONT lo
rechaza OMCI con `%Code 63990-GPONRM: ONT return error: command processing error`
(exactamente el error que veíamos todo el día), o directamente nunca intenta pedir
IP por DHCP en la VLAN de gestión.

El driver actual (`authorizeOnu()` / `generateAuthorizationScript()`, líneas ~672-732
de `zte-c320.driver.ts`) solo manda `tr069-mgmt 1 acs <url>` + `tr069-mgmt 1 tag pri 2
vlan <vlan>` dentro de `pon-onu-mng` — **no** manda nada del bloque de arriba.

## Causa raíz 2 — Los SET de OMCI no son idempotentes

Reenviar un comando `tr069-mgmt ...` que el ONT ya aceptó antes (mismo valor) puede
ser RECHAZADO por el ONT (`%Code 63990`), y eso hace que `Config state` (visible con
`show gpon onu detail-info <iface>`) pase de `success` a `fail` — el ONT queda en un
estado de sincronización OMCI roto hasta que se reinicia.

- **Nunca reenviar** un `tr069-mgmt` que ya se aplicó con éxito antes, "por las dudas".
- Si `Config state` queda en `fail` tras cualquier cambio OMCI, el único arreglo
  confirmado es reiniciar el ONT (ver abajo) para forzar un resync completo.
- `validate none` y `validate disable` (para limpiar credenciales viejas tipo las que
  deja SmartOLT) fueron RECHAZADOS por este ONT (`%Code 63990`) — no hay forma
  confirmada todavía de limpiar un `validate basic username/password` ya aplicado.
  No parece bloquear la comunicación (GenieACS no exige auth), así que se dejó así.

### Cómo reiniciar el ONT vía OMCI (cuando hace falta forzar resync)

El comando `reboot` dentro de `pon-onu-mng <iface>` pide confirmación interactiva
(`Confirm to reboot? [yes/no]:`) que el wrapper normal de comandos no sabe responder.
Hay que escribir directo al socket de la sesión Telnet:

```js
session.socket.write('reboot\r\n');
// esperar el patrón /\[yes\/no\]:\s*$/i en los datos entrantes del socket
session.socket.write('yes\r\n');
```

Tras el reboot, el ONT pasa por `Phase state: syncMib` (transitorio) antes de llegar
a `Phase state: working` / `Config state: success`. Verificar con:

```
show gpon onu detail-info <iface>
```

## Causa raíz 3 — El NAT del MikroTik no cubre la VLAN de gestión TR-069

Aun con el OMCI completo y el ONT con IP por DHCP en la VLAN de gestión (confirmado:
`show mac vlan <vlan>` mostraba la MAC del ONT aprendida, y el MikroTik sí le daba
lease DHCP), el ONT **nunca lograba conectar** a GenieACS. Se confirmó con
`ip/firewall/connection` en el MikroTik: el ONT SÍ intentaba resolver DNS
(`8.8.8.8`/`8.8.4.4`) y abrir conexiones, pero esos paquetes salían con
`srcnat: false` y nunca recibían respuesta (`seen-reply: false`).

Causa: la ruta por defecto (`0.0.0.0/0`) de este MikroTik sale por la interfaz
`BRP-RED`, pero `BRP-RED` está deshabilitada en la lista de interfaces `"Wan"` que usa
la regla de masquerade genérica (`ip firewall nat`, acción masquerade, `out-interface-list=Wan`).
El tráfico de clientes reales (PPPoE) usa una regla totalmente distinta
(`out-interface=all-ppp`) y nunca pasa por esta ruta — por eso el NAT general
"parecía" funcionar bien aunque este hueco llevara tiempo ahí.

**No se tocó `BRP-RED` ni la lista `"Wan"`** (eso sí afectaría tráfico compartido).
Se usó la alternativa de abajo, más segura.

## Solución aplicada: usar el túnel WireGuard en vez de la URL pública

Idea del usuario, validada: en vez de arreglar el NAT hacia internet pública, usar
el túnel WireGuard que YA conecta cada MikroTik con la VPS central (el mismo que se
usa para Telnet/RouterOS API contra cada OLT). GenieACS corre en esa misma VPS.

Hechos confirmados:
- La VPS es el hub WireGuard: interfaz `wg0`, IP `10.254.0.1/16`.
- El contenedor `genieacs-cwmp` publica el puerto 7547 en `0.0.0.0:7547` — ya
  alcanzable en `10.254.0.1:7547` por el túnel, sin pasar por el dominio público.
- Cada nodo (MikroTik) es un peer del hub con `allowed-ips` angosto (solo su propia
  IP de túnel, ej. `10.254.2.2/32`) — por eso hace falta una regla de NAT para que el
  tráfico de la subred de gestión "se disfrace" de esa IP al entrar al túnel.

### Pasos (por nodo)

1. **MikroTik del nodo** — regla de NAT acotada SOLO a la subred de gestión TR-069
   de ese nodo, saliendo por su interfaz WireGuard hacia el hub:

   ```
   /ip firewall nat add chain=srcnat action=masquerade \
     src-address=<CIDR-tr069-de-ese-nodo> out-interface=<wg-del-nodo> \
     comment=sumtech-tr069-nat-wg
   ```

   Para `Nodo_Tabara_Abajo`: `src-address=10.15.152.0/22 out-interface=wg-sumtech`.
   **No** tocar `BRP-RED` ni la lista `"Wan"` — esta regla es independiente y no
   afecta a clientes ni a otras VLANs.

2. **ONU** — apuntar `tr069-mgmt 1 acs` a la IP interna del hub en vez del dominio
   público:

   ```
   pon-onu-mng <iface>
   tr069-mgmt 1 acs http://10.254.0.1:7547
   end
   write
   ```

   Luego reiniciar el ONT (ver Causa raíz 2) para forzar el resync.

3. Para que esto salga ya así desde la GUI, lo más limpio es actualizar el campo
   `acs_url` del `net.tr069_networks` que use ese nodo (entidad
   `Tr069NetworkEntity`, columna `acs_url`) a `http://10.254.0.1:7547` en vez de
   `http://acs.sumtech.com.do:7547` — **pero solo después de aplicar el paso 1 en el
   MikroTik de ese nodo**, si no, el ONT no tendrá a quién mandarle la respuesta.

### Por qué esto es mejor que arreglar `BRP-RED`

- Cero cambios en la interfaz de salida a internet compartida con clientes.
- Cero cambios en el hub WireGuard de la VPS (que sirve a todos los nodos/tenants).
- El tráfico de gestión TR-069 nunca toca internet pública — más privado.
- El cambio es 100% reversible por nodo sin afectar a los demás.

## Qué pasa si autorizas una ONU nueva desde la GUI de Sumtech HOY

Con el código actual (sin aplicar los fixes de este documento):

1. ✅ El internet del cliente se provisiona bien — TR-069 está tratado como
   "mejor esfuerzo" (`warning`, no `error`) en `authorizeOnu()`, así que un fallo ahí
   nunca bloquea el servicio principal.
2. ❌ El ONT probablemente **no** llegará a hablar con GenieACS, por la Causa raíz 1
   (falta el segundo service-port + el bloque `flow`/`iphost`/`veip`) — el mismo
   síntoma de hoy: `tr069-mgmt acs` puede aceptarse o rechazarse, pero sin esa
   configuración interna el ONT no tiene cómo enrutar tráfico de gestión.
3. ❌ Aunque el OMCI estuviera completo, si el nodo usa todavía la URL pública
   (`acs.sumtech.com.do`) y su MikroTik no tiene la regla de NAT de la Causa raíz 3,
   el ONT seguiría sin poder llegar a GenieACS (mismo bloqueo de NAT).
4. El flujo no hace un reboot automático del ONT tras tocar `tr069-mgmt` — si algún
   día se agrega el bloque OMCI completo al driver, hay que agregar también un
   reboot al final del bloque TR-069, o el ONT puede quedar en `Config state: fail`
   sin que nadie lo note.

En resumen: **autorizar desde la GUI no rompe nada (el cliente sí queda con
internet), pero no replica lo que logramos hoy a mano** — toca seguir hasta que se
actualice `generateAuthorizationScript()` con el bloque OMCI completo y se agregue
el reboot post-configuración. Mientras tanto, cualquier ONU nueva que necesite
TR-069 real requiere repetir manualmente los pasos de este documento.

## Pendiente (no resuelto hoy)

- Agregar a `zte-c320.driver.ts` el segundo tcont/gemport/service-port + el bloque
  `flow`/`switchport-bind`/`ip-host`/`vlan-filter`/`veip` dentro de `pon-onu-mng`,
  parametrizado por `config.tr069Vlan`.
- Agregar un reboot (vía el mecanismo de socket directo) al final del bloque TR-069
  en `authorizeOnu()`, solo si se tocó `tr069-mgmt`.
- Decidir una convención para `acs_url` por nodo (URL pública vs. IP del hub
  WireGuard) y, si se usa la IP del hub, automatizar la creación de la regla de NAT
  del paso 1 (similar a `ensureNatMasquerade`/`ensureAcsAutoProvisioning` que ya
  existen en `routeros-client.ts`) en vez de aplicarla a mano por nodo.
- No hay forma confirmada de limpiar credenciales `validate basic` viejas (ej. las
  que deja SmartOLT) de un ONT ya autorizado — `validate none`/`validate disable`
  fueron rechazados. No bloqueó la comunicación en este caso.
- El bug de "scan-unconfigured" que parece sobreescribir/borrar el vínculo
  contrato/tipo/servicio de una ONU existente si el OLT la reporta como
  no-configurada de nuevo (visto de pasada hoy, no reproducido a fondo ni corregido).

## Actualización 2026-10-22 — causa raíz real de "%Code 63990" encontrada: "Max VEIP: 0"

El datapath/cableado OMCI de la sección anterior (confirmado 2026-10-20) resultó
NO ser la causa completa. Tras dividir `authorizeOnu()` en 3 etapas (OLT/TR-069/WAN,
ver `generateTr069ManagementScript`/`applyTr069Management`), la Etapa 2 seguía
fallando en producción para la ONU `CMDCDD4D131E` (onu-type `HUAWEY-HG8145V5` en
`OLT_Tabara_Abajo`) con el mismo `%Code 63990-GPONRM`.

Verificado en vivo (`show onu-type gpon HUAWEY-HG8145V5`, solo lectura): ese
onu-type tiene **`Max VEIP: 0`**. El comando `veip 1 port udp 1232 host 2` del
bloque TR-069 exige que el onu-type soporte al menos 1 VEIP -- con `Max VEIP: 0`
la OLT acepta el comando pero el ONT lo rechaza a nivel OMCI, exactamente el
síntoma observado.

Sintaxis real de `max-veip` confirmada vía ayuda contextual de la propia OLT
(`onu-type <nombre> gpon ?` dentro de `pon`, en modo config): es un keyword más,
sibling de `max-tcont`/`max-gemport`/etc., sin orden obligatorio.

**Fix aplicado:** `ensureOnuTypeProfileWithSession()` en `zte-c320.driver.ts` ahora
agrega `max-veip 1` al crear un onu-type nuevo. **Esto NO corrige onu-types que ya
existían antes del fix** (como `HUAWEY-HG8145V5`, que claramente ya existía en la
OLT desde antes -- `ensureOnuTypeProfileWithSession` lo detectó como
`alreadyExists` y nunca lo tocó) -- esos quedan con `Max VEIP: 0` hasta corregirse
a mano con `onu-type <nombre> gpon max-veip 1` (sintaxis no reprobada aún en vivo
para el caso de ACTUALIZAR un onu-type existente, solo para crearlo).

**Pendiente:**
- Corregir a mano `max-veip` en los onu-types ya existentes que necesiten TR-069
  (al menos `HUAWEY-HG8145V5` en `OLT_Tabara_Abajo`; posiblemente también
  `HUAWEY-BT546XG`, mencionado en el mismo comentario de `ensureOnuTypeProfile`).
- Reconfirmar en vivo el flujo de 3 etapas completo contra un onu-type NUEVO
  (creado por este driver con el fix, no uno preexistente) antes de subir
  `tr069AutoProvisioning`/`onuTypeProfileProvisioning` a `true`.
- Durante la investigación se probó por error la ayuda contextual `?` sobre
  `onu-type <nombre> gpon <params...> ?` de forma incremental -- a diferencia de
  `tr069-mgmt 1 ?` (que SÍ es seguro porque `tr069-mgmt 1` solo nunca es una
  acción completa), aquí el `?` SÍ llegó a crear un onu-type de prueba real
  (`PROBEVEIPCHK`) porque `onu-type <nombre> gpon` por sí solo ya es un comando
  completo con `<cr>` disponible. Lección: en este CLI, el riesgo de "`?` ejecuta
  el comando" depende de si el PREFIJO antes del `?` ya es una acción válida por
  sí sola, no es una propiedad general segura de todo el CLI ZTE.

## Actualización 2026-10-22 (más tarde, mismo día) — "Max VEIP" era necesario pero NO la causa raíz real

Tras corregir `Max VEIP` (sección anterior) y probarlo contra un onu-type
**nuevo y dedicado** (`HUAWEY-HG8145V5-TR069`, creado desde cero con
`max-veip 1` incluido, sin el problema de "Profile is being used" de un
onu-type compartido), `tr069-mgmt 1 acs <url>` **siguió siendo rechazado**
con el mismo `%Code 63990-GPONRM`. Revisando el log línea por línea: el
comando `veip 1 port udp 1232 host 2` **siempre se había aceptado sin
rechazo**, en TODOS los intentos de esta investigación, con o sin el fix de
Max VEIP -- la atribución de la causa raíz a "Max VEIP: 0" nunca se verificó
contra cuál comando específico fallaba, y era incorrecta.

**Causa raíz real**, encontrada comparando contra un running-config real y
**funcionando** de otra ONU en la misma OLT (ONU `HWTCDE64BA7C`, modelo
Huawei BT546XG, aprovisionada por SmartOLT, con `tr069-mgmt ... acs ...`
realmente aplicado): a `generateTr069ManagementScript()` le faltaba
`switchport-bind switch_0/1 veip 1` -- solo se hacía el bind del `iphost 2`,
nunca el del propio VEIP. Sin ese bind, el VEIP (donde vive el ME de
`ManagementServer` que atiende TR-069) nunca queda conectado a ningún camino
de datos real dentro del switch fabric interno del ONT, así que el ONT
rechaza cualquier intento de configurar su `ManagementServer` con
`%Code 63990-GPONRM : ONT return error: command processing error.`

**Fix aplicado:** se agrega `switchport-bind switch_0/1 veip 1` justo antes
de `veip 1 port udp 1232 host 2`, mismo orden que el ejemplo real. El fix de
`Max VEIP` del día (sección anterior) se mantiene -- sigue siendo un
prerequisito real documentado por la propia OLT, solo que no era la pieza
que estaba causando el rechazo del ACS en este caso concreto.

**Lección de proceso:** nunca declarar una causa raíz "confirmada" sin
revisar, en el log real, CUÁL comando específico produjo el rechazo --
asumir que el único error visible (`%Code 63990` en `tr069-mgmt ... acs
...`) venía de la pieza que se acababa de tocar (`veip 1 port udp ...`,
afectada por Max VEIP) sin verificarlo línea por línea costó una iteración
completa de diagnóstico equivocado.

## Actualización 2026-10-22 (tarde) — TR-069/gestión funciona de punta a
## punta; el WAN/PPPoE de Internet nunca activa, y no es la OLT

Con el fix de `switchport-bind switch_0/1 veip 1` ya en producción, la ONU
`CMDCDD4D131E` (onu-type `HUAWEY-HG8145V5-TR069`, OLT `OLT_Tabara_Abajo`,
`gpon-onu_1/2/15:1`) quedó **informando correctamente a nuestro GenieACS**
(`ManagementServer.URL = http://10.254.0.1:7547`, `_lastInform` actualizado
cada pocos segundos, confirmado en vivo repetidas veces). La capa de gestión
TR-069 está resuelta. El problema que queda es exclusivamente el WAN de
Internet: `WANPPPConnection.1` se queda para siempre en
`ConnectionStatus: Connecting` / `LastConnectionError: ERROR_NO_ANSWER`.

Esta sección documenta todo lo que se verificó HOY en vivo (no son teorías)
para que la próxima persona que retome esto no repita el trabajo.

### Hallazgo 1 (bug real, corregido en vivo pero NO fue la causa) — `CpeParameterMapper` nunca conoce el modelo de datos CMCC de esta ONU

El fabricante real de este hardware, reportado por el propio dispositivo vía
TR-069, es **CMDC** (`Vendor ID: CMDC`, `Detected ONU type: HG8546M-XPON`) --
es un clon/rebranding de un Huawei HG8145V5, no un Huawei genuino. Su modelo
de datos TR-098 usa la extensión **CMCC** (China Mobile), con parámetros como
`X_CMCC_VLANIDMark`, `X_CMCC_VLANMode`, `X_CMCC_ServiceList` en vez de los que
`CpeParameterMapper.buildTR098Params()` conoce (`X_HW_VLAN` para Huawei,
`X_ZTE-COM_VLAN` para ZTE, `X_BROADCOM_COM_VLANID` como fallback genérico).

Confirmado en vivo con `getParameterValues`/`setParameterValues` directos
contra GenieACS: el dispositivo **no tiene** `X_HW_VLAN` en su árbol de
parámetros (la escritura a esa ruta nunca pudo haber tenido efecto), y sí
tiene `X_CMCC_VLANIDMark` real y escribible. Se encontró que este campo
llevaba atascado en **404** mientras la OLT tiene cableada la ONU para la
VLAN **400** (confirmado contra `service-port 1 vport 1 user-vlan 400 vlan
400` real y contra `OnuServiceConfigEntity.serviceVlanId` resuelto a VLAN
400) -- un valor huérfano de algún intento anterior de esta sesión de
pruebas, nunca corregido porque nuestro código nunca apunta a ese parámetro.

**Corregido en vivo (manual, vía script, no vía código todavía):**
`X_CMCC_VLANIDMark` se puso en 400, confirmado persistente tras releer y
tras forzar un re-init de la conexión (`Enable` false→true). **El
`ConnectionStatus` no cambió** -- sigue en `Connecting`/`ERROR_NO_ANSWER`
exactamente igual. Es decir: este bug es real y vale la pena corregirlo en
`CpeParameterMapper` (agregar una rama CMCC, o mejor, detectar en runtime qué
parámetro de VLAN existe realmente en el dispositivo antes de escribir), pero
**no es la causa del problema actual** -- se descarta como causa raíz, no
como bug.

### Hallazgo 2 (bug real, afecta a cualquier cliente) — cambiar solo la IP de un acceso ya ACTIVE nunca re-sincroniza a RouterOS

Al editar manualmente la IP del secret de `test3` desde "Editar Secret
PPPoE" (de `192.168.114.5` a `100.66.11.235`, dentro del rango con salida a
Internet), el cambio se guardó en `network_access.ip_address` pero **nunca
llegó al secret real en el MikroTik** -- confirmado leyendo el secret en vivo
(`remoteAddress` seguía en el valor viejo). Causa: en
`NetworkProvisioningService.upsertConfiguration()`, el re-aprovisionamiento
hacia RouterOS (`transition(...)`) solo se dispara en dos casos: cuando el
acceso pasa de `PENDING` a tener nodo/usuario (alta inicial), o cuando
**cambia la contraseña** de un acceso ya `ACTIVE`. Cambiar la IP (o el nodo,
o la VLAN, o el alias) de un acceso ya `ACTIVE` se persiste en Sumtech pero
jamás dispara un push real al router. Esto afecta a cualquier cliente real,
no solo a esta ONU de prueba.

**Corregido en vivo (manual):** se llamó directo a
`RouterOsProvisioningAdapter.provision(access)` con el acceso ya guardado,
reusando el mismo código de producción. **Pendiente corregir en código:**
`upsertConfiguration()` debería re-sincronizar también ante cambios de IP/
nodo/VLAN/alias en un acceso ya activo, no solo ante cambio de contraseña.

### Hallazgo 3 (bug de UX real) — "Alias de Servicio" se usa tal cual como perfil PPP de RouterOS, sin validación ni aviso

El primer intento de re-sincronizar el secret de `test3` falló con
`400: input does not match any value of profile` porque el campo "Alias de
Servicio" del modal "Editar Secret PPPoE" tenía el valor `t3`, y
`RouterOsProvisioningAdapter.provision()` usa `access.serviceAlias` tal cual
como el nombre del perfil PPP (`/ppp/profile`) a aplicar en el secret --
campo que en el router solo tiene `default` creado. El modal no indica en
ningún lado que ese campo deba coincidir EXACTO con un perfil ya existente en
RouterOS; se ve como una etiqueta libre. Se corrigió manualmente a `default`
para esta prueba. **Pendiente:** el modal debería listar los perfiles reales
del nodo (ya existe `getNodeProfiles()` en `PppManagementService`) en vez de
un campo de texto libre, o al menos validar/avisar contra esa lista antes de
guardar.

### Comparación exhaustiva de la OLT (OMCI) contra una ONU real y funcionando -- se descarta la OLT como causa

Se comparó, línea por línea, el bloque `pon-onu-mng` COMPLETO y EN VIVO de
`CMDCDD4D131E` contra el de `HWTCDE64BA7C` (M0761, cliente real con Internet
funcionando, mismo OLT, aprovisionado por SmartOLT), ambos sacados del mismo
volcado para que la comparación sea del mismo instante:

```
# Nuestra ONU (gpon-onu_1/2/15:1) -- canal Internet (vport 1 / VLAN 400)
flow mode 1 tag-filter vlan-filter untag-filter discard
flow 1 pri 0 vlan 400
gemport 1 flow 1
switchport-bind switch_0/1 iphost 1
vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard
vlan-filter iphost 1 pri 0 vlan 400

# M0761 (gpon-onu_1/2/7:5) -- canal Internet (vport 1 / VLAN 400)
flow mode 1 tag-filter vlan-filter untag-filter discard
flow 1 pri 0 vlan 400
gemport 1 flow 1
switchport-bind switch_0/1 iphost 1
vlan-filter-mode iphost 1 tag-filter vlan-filter untag-filter discard
vlan-filter iphost 1 pri 0 vlan 400
```

**Idénticos, comando por comando.** El VEIP, en ambas ONUs, está enlazado
SOLO al canal de gestión (`veip 1 port udp 1232 host 2`) -- ninguna de las
dos lo enlaza al canal de Internet, así que la teoría de "falta enlazar el
VEIP al host 1" (barajada durante esta sesión) queda descartada: la ONU que
sí funciona tampoco lo tiene así.

Las únicas diferencias reales encontradas son del lado LAN/VoIP, no del WAN:
`voip protocol sip` (M0761 tiene puerto de voz en uso), 4 líneas
`dhcp-ip ethuni eth_0/1..4 from-onu` (comportamiento DHCP de los puertos LAN
de la ONU) y `security-mgmt 998/999` (reglas de acceso remoto LAN). Se
revisó también `show gpon onu detail-info` de ambas: `Line Profile` y
`Service Profile` están en `N/A` en las dos (no es un diferenciador), y
`Config state` está en `fail` en M0761 (¡la que SÍ funciona!) -- ese campo
tampoco es una señal de salud confiable para este modelo de ONT.

**Conclusión: la configuración de la OLT para el canal de Internet es
indistinguible de la de un cliente real que funciona.** No hay nada más que
corregir ahí.

### Evidencia definitiva -- la ONU nunca generó tráfico real en VLAN 400

La tabla de aprendizaje de MACs de la propia OLT (`MACs on OLT from this
ONU`, SmartOLT) es el dato más concluyente de toda la investigación:

```
# Nuestra ONU (CMDCDD4D131E) -- UNA sola MAC, solo en VLAN 46:
98:7d:dd:4d:13:18   46    gpon-onu_1/2/15:1   vport 2

# M0761 (HWTCDE64BA7C) -- DOS MACs, una por canal:
24:16:6d:de:64:bb   400   gpon-onu_1/2/7:5    vport 1   (Internet)
24:16:6d:de:64:bc   46    gpon-onu_1/2/7:5    vport 2   (Gestión)
```

M0761 usa una MAC distinta por cada interfaz WAN de su router interno (normal
en un HGU) y la OLT aprendió tráfico real en AMBAS. Nuestra ONU **jamás ha
generado ni un solo paquete en VLAN 400/vport1** -- ni ARP, ni el PADI de
PPPoE, nada. Esto es tráfico real observado por la OLT, no una
configuración: confirma que el bloqueo no es la OLT, no es el MikroTik (ya
verificado con VLAN 400 + servidor PPPoE "service5" + secret "test3" todos
correctos), y no es GenieACS en el sentido de "no llega la orden" (sí llega:
`Username`, `Enable`, `X_CMCC_VLANIDMark` se escriben y persisten con
éxito). El router interno de esta ONU específica simplemente nunca activa su
interfaz WAN de Internet (`WAN ID 1` en la terminología de SmartOLT), pese a
que el objeto TR-069 `WANPPPConnection.1` reporta `Enable: TRUE`.

### Hipótesis de trabajo para retomar -- GenieACS puede estar fallando en ACTIVAR la WAN, no solo en configurarla

El usuario señala, con buena razón, que toda la evidencia apunta a GenieACS:
tenemos conexión de gestión perfecta con la ONU (prueba de que la ruta
GenieACS↔ONU funciona), pero la WAN de Internet nunca se activa a nivel de
firmware, pese a que `Enable: true` está puesto. Esto sugiere que
`Enable: true` en `WANPPPConnection.1` **no es, por sí solo, suficiente para
que este firmware CMCC "encienda" esa interfaz WAN** -- probablemente haga
falta algún otro parámetro (de la familia `X_CMCC_*`, ver el volcado completo
de 116 parámetros capturado hoy) que actúe como el verdadero "switch" de
activación, o un orden de escritura específico (ej. crear el objeto, escribir
`Enable` primero y luego el resto, o viceversa), que no estamos replicando.

**Qué falta probar, en orden de costo/beneficio:**
1. Revisar el volcado completo de 116 parámetros `*VLAN*`/`*CMCC*` ya
   capturado hoy (`X_CMCC_PPPOE_EMULATOR`, `X_CMCC_DHCPOPTION60`, etc.) en
   busca de algún flag de activación que hoy no se toca.
2. Probar el diagnóstico embebido `InternetGatewayDevice.X_CMCC_PPPOE_EMULATOR`
   (WANInterface/Username/Password/DiagnosticsState) -- es una prueba de
   marcado aislada que el propio firmware CMCC expone para testear PPPoE sin
   tocar la conexión WAN real; nunca se ha usado. Puede revelar un mensaje de
   error más específico que `ERROR_NO_ANSWER`.
3. Recrear `WANPPPConnection.1` desde cero (borrar el objeto vía
   `DeleteObject` si GenieACS lo soporta, o renumerar, y volver a aplicar
   `AddObject` + `SetParameterValues` en un solo flujo limpio) por si quedó
   en un estado parcialmente corrupto de los múltiples intentos manuales de
   hoy.
4. Reiniciar la ONU por OMCI (reboot real, no solo `Enable` false→true) --
   **intentado hoy, falló por un problema de sesión Telnet contra la OLT**
   (`pon-onu-mng gpon-onu_1/2/15:1` rechazado con "Invalid input" 3 veces
   seguidas, con la sesión ya dentro de `(config-if)#` de esa misma interfaz
   -- no reproducido antes en esta misma sesión con la misma secuencia
   exacta). Pendiente reintentar con más cuidado o hacerlo manual desde
   SmartOLT.

### Pendiente (no resuelto hoy)

- La causa raíz de por qué el WAN de Internet nunca activa sigue sin
  confirmarse -- se descartaron OLT, MikroTik y "GenieACS no manda la
  orden", pero no se ha probado la hipótesis de que falte un parámetro de
  activación específico del modelo de datos CMCC.
- Corregir `CpeParameterMapper` para el modelo de datos CMCC (Hallazgo 1).
- Corregir `NetworkProvisioningService.upsertConfiguration()` para
  re-sincronizar RouterOS ante cambios de IP/nodo/VLAN en accesos ya
  `ACTIVE`, no solo cambio de contraseña (Hallazgo 2).
- Mejorar el modal "Editar Secret PPPoE" para que "Alias de Servicio" valide
  contra los perfiles reales del nodo en vez de aceptar texto libre
  (Hallazgo 3).
- Reintentar el reinicio OMCI de la ONU de prueba (bloqueado hoy por un
  fallo de sesión Telnet, no confirmado si es reproducible).

### Dos hipótesis más descartadas en vivo, con evidencia -- `TransportType` y "objeto corrupto"

**`TransportType: "L2TP"` es de solo lectura, confirmado escribiendo en
vivo.** Se intentó `setParameterValues` sobre
`WANPPPConnection.1.TransportType = "PPPoE"`: GenieACS reportó la tarea como
exitosa (el CPE no devolvió fault), pero al releer el parámetro inmediatamente
después seguía en `"L2TP"` -- el CPE acepta la orden sin aplicarla de verdad.
Coincide con el estándar TR-098, que define `TransportType` como informativo,
no configurable. **Se descarta como causa posible para cualquiera, no solo
para Sumtech** -- ningún ACS puede cambiar ese valor en este firmware.

**Borrar y recrear `WANPPPConnection.1` desde cero tampoco cambió nada.** Se
hizo vía el mecanismo real de GenieACS NBI 1.2.x (tareas `deleteObject` /
`addObject` contra `/devices/:id/tasks` -- la NBI de esta versión NO expone
`DELETE /objects/...` ni `PUT /objects/N` como API REST directa, a diferencia
de lo que sugería una recomendación externa): se borró la instancia, se
recreó con `addObject`, GenieACS la renumeró de nuevo como `.1`, se
re-aplicaron todos los parámetros (`Enable`, `ConnectionType`, `Username`,
`Password` real del access, `X_CMCC_VLANIDMark=400`, `X_CMCC_VLANMode`,
`X_CMCC_ServiceList`, `NATEnabled`) sin ningún fault. Entre medio la ONU tuvo
una reconexión real (confirmada por `show gpon onu detail-info`: nueva
entrada de `Online Duration` de apenas minutos). Resultado: exactamente
igual, `ConnectionStatus` pasó a `"Disconnecting"` (antes `"Connecting"`,
variación menor sin significado aparente) con el mismo
`LastConnectionError: ERROR_NO_ANSWER`. Se descarta "objeto TR-069 en estado
corrupto" como causa.

### Verificación campo-por-campo: ¿puede GenieACS configurar todo lo que ofrece la página web local de la ONU?

Se comparó el formulario completo de "Configuración WAN" de la interfaz web
local del equipo (Encapsulation Mode, VLAN ID, 802.1p, MRU, Enable LCP
Detection, Binding Options LAN/SSID, NAT, NAT type, DNS Override, Dialing
Method, Multicast VLAN ID) contra el árbol real de parámetros TR-069 del
dispositivo (183 parámetros capturados). **Casi todos existen y son
escribibles por TR-069**, confirmados con sus valores reales actuales:

| Campo de la página web          | Parámetro TR-069 real                          | Estado |
|----------------------------------|-------------------------------------------------|--------|
| Enable WAN                       | `WANPPPConnection.1.Enable`                     | ✅ TRUE |
| Protocol Type (IPv4)             | `X_CMCC_IPMode`                                 | ✅ = 1 |
| WAN Mode (Route)                 | `ConnectionType`                                | ✅ PPPoE_Routed |
| Service Type                     | `X_CMCC_ServiceList`                            | ✅ INTERNET |
| VLAN ID / Enable VLAN            | `X_CMCC_VLANIDMark` / `X_CMCC_VLANMode`         | ✅ 400 / 1 |
| 802.1p                           | `X_CMCC_802-1pMark`                             | ✅ existe |
| MRU                              | `MaxMRUSize` / `CurrentMRUSize`                 | ✅ 1500 / 1492 |
| Usuario/Contraseña               | `Username` / `Password`                         | ✅ test3 / (oculto) |
| Enable LCP Detection             | `PPPLCPEcho` / `PPPLCPEchoRetry`                | ✅ 30 / 3 |
| Binding Options (LAN1-4/SSID1-4) | `X_CMCC_LanInterface`                           | ✅ las 4 LAN + SSID1 |
| Enable NAT                       | `NATEnabled`                                    | ✅ TRUE |
| Enable DNS Override              | `DNSOverrideAllowed` / `DNSEnabled`             | ✅ existen |
| Dialing Method (Automatic)       | `ConnectionTrigger`                             | ✅ AlwaysOn |
| Multicast VLAN ID                | `X_CMCC_MulticastVlan`                          | ✅ existe (-1, fuera del rango 0-4094 documentado en la UI, revisar) |
| **NAT type** (Port-restricted cone) | **no encontrado** en el árbol de parámetros  | ❓ posible brecha, sin confirmar |

**Conclusión: GenieACS sí puede configurar prácticamente todo este
formulario para este dispositivo.** La única duda real es "NAT type", que no
apareció en el árbol de parámetros explorado (podría no ser configurable vía
TR-069 en este firmware, o vivir bajo un nombre no contemplado en la
búsqueda). Esto descarta la hipótesis de "faltan parámetros por exponer" --
todo lo que de verdad importa para WAN/PPPoE ya se manda correctamente.

### Actualización 2026-10-22 (noche) — CAUSA RAÍZ REAL ENCONTRADA: catálogo de Sumtech con `vendorTypeName` equivocado

Todo lo anterior en esta sección (comparaciones OMCI, parámetros TR-069, VLAN,
MikroTik, `TransportType`, borrar/recrear el objeto WAN) **era correcto, pero
no era la causa**. La causa real es mucho más simple y estaba en nuestro
propio catálogo, no en la ONU ni en GenieACS ni en la OLT.

**Hallazgo:** el usuario autorizó y aprovisionó esta misma ONU directamente
desde SmartOLT (fuera de Sumtech) y, por primera vez en todo el día, la OLT
aprendió una MAC real en VLAN 400/vport1 (`987d.dd4d.1318`) y el MikroTik
mostró una sesión PPPoE activa y funcionando (`tt3`, IP `100.66.11.237`,
23+ minutos de uptime). Comparando el bloque OMCI que usó SmartOLT contra el
que generaba nuestro propio driver, los comandos eran **sustancialmente los
mismos** (mismo flow/gemport/switchport-bind/veip/tr069-mgmt) -- la única
diferencia real era el **nombre del onu-type**: SmartOLT usó `HUAWEY-HG8546M`
(el modelo real del equipo, confirmado por `Vendor ID: CMDC`, `Detected ONU
type: HG8546M-XPON`); Sumtech llevaba todo el día usando `HUAWEY-HG8145V5` /
`HUAWEY-HG8145V5-TR069` -- un modelo DISTINTO.

Verificado en la base de datos (`net.onu_types`):

```
vendor=HUAWEI, model=HG8546M, vendorTypeName="HUAWEY-HG8145V5"   ← BUG
```

El campo `model` del catálogo decía correctamente "HG8546M", pero
`vendorTypeName` (el nombre real que se manda a la OLT en
`onu <id> type <X> sn <Y>`) apuntaba al onu-type de OTRO modelo. La OLT
aplicaba entonces la plantilla de capacidades de hardware equivocada --
mismos comandos CLI en apariencia, pero interpretados contra un perfil de
chip/firmware distinto, lo que impedía que el router interno de la ONU
activara de verdad su interfaz WAN, sin importar qué tan "correcta" se viera
la configuración de OLT/MikroTik/GenieACS (que, de hecho, sí lo estaban).

**Impacto real, no solo de laboratorio:** este mismo catálogo mal mapeado
estaba siendo usado por 2 ONUs reales ya `ACTIVE` (`HWTC486A3493` y
`ZTEGCC6E3E37`, mismo contrato), ambas atrapadas en el mismo bucle de fallo
("Reintento automático de push a GenieACS falló... aún no ha enviado
Inform.") cada 2 minutos.

**Fix aplicado (2026-10-22, con aprobación explícita del usuario):**

```sql
UPDATE net.onu_types SET vendor_type_name = 'HUAWEY-HG8546M'
WHERE vendor_type_name = 'HUAWEY-HG8145V5';
```

Nota aparte: también se confirmó en vivo que `Max VEIP: 0(default: 1 VEIP)`
en `show onu-type gpon <nombre>` es un dato engañoso -- el sufijo
"(default: 1 VEIP)" indica que la OLT ya trata 0 como "usa el default de 1"
cuando el ONT lo requiere. Esto es consistente con el hallazgo de la
actualización anterior ("Max VEIP era necesario pero NO la causa raíz real")
y cierra definitivamente esa pista como irrelevante.

**Lección de proceso, la más cara de todo el día:** nunca se verificó que el
`vendorTypeName` del catálogo de Sumtech coincidiera con el modelo real del
equipo -- se asumió que, como el campo `model` decía "HG8546M", el onu-type
usado en la OLT también correspondía a ese modelo. Para una entidad con dos
campos que DEBERÍAN estar sincronizados (`model` descriptivo vs
`vendorTypeName` operativo) pero que el código nunca valida entre sí, un
error de tipeo al crear el catálogo puede pasar desapercibido indefinidamente
-- la ONU se autoriza "con éxito", la OLT no rechaza nada, y el síntoma
(WAN que nunca activa) apunta hacia GenieACS/TR-069, no hacia el catálogo.

### Conclusión final (resuelto)

La sesión de hoy agotó, con evidencia en vivo, todas las hipótesis del lado
GenieACS/OLT/MikroTik antes de encontrar la causa real: configuración OMCI
verificada idéntica a un cliente real, parámetros TR-069 correctos y
persistentes, secret PPPoE y VLAN correctos en el MikroTik, objeto TR-069
recreado desde cero, `TransportType` confirmado de solo lectura -- todo eso
era, en efecto, intachable. La hipótesis de "limitación de firmware de este
clon CMDC" que se sostuvo por varias horas **quedó descartada**: la causa
real era un `vendorTypeName` equivocado en el catálogo de Sumtech
(`HUAWEY-HG8145V5` en vez de `HUAWEY-HG8546M`, el modelo real del equipo),
que hacía que la OLT aplicara la plantilla de capacidades de hardware de un
modelo distinto. Corregido el catálogo, el mismo equipo físico que llevaba
todo el día sin transmitir un solo paquete en VLAN 400 autenticó PPPoE con
éxito (confirmado con sesión activa real en el MikroTik). Fix aplicado y
documentado arriba, afecta también a 2 ONUs reales que tenían el mismo
catálogo mal mapeado.
