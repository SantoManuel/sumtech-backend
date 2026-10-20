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
