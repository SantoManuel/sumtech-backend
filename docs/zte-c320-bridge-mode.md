# Modo Bridge ZTE C320

El backend permite autorizar en Bridge y cambiar el modo de ONUs activas mediante OMCI.

## API

- `GET /olt/onus/:id/operation-mode`: consulta la configuraci?n real y devuelve modo, VLANs, puertos y evidencias. Requiere permiso VIEW.
- `POST /olt/onus/:id/operation-mode`: cuerpo `{"operationMode":"BRIDGE"}` o `{"operationMode":"ROUTER"}`. Requiere CONFIGURE.

Ambas rutas usan autenticaci?n, roles ADMIN/GERENTE/TECNICO y permisos de la OLT de la ONU. Solo los drivers con estos m?todos opcionales soportan la operaci?n; actualmente ZTE C320.

## Ejecuci?n y persistencia

El cambio exige ONU ACTIVE, VLAN de servicio conocida y cantidad real de puertos del cat?logo. Serializa mutaciones de la ONU y acceso Telnet a la OLT. Lee el modo antes de escribir; rechaza configuraciones mixtas/desconocidas, VLAN discrepante o puertos incompatibles. Si el modo ya coincide, no reenv?a comandos.

La transici?n utiliza exclusivamente pon-onu-mng: no elimina ni reinicia la ONU y no modifica transporte GPON ni gesti?n TR-069. Las delegaciones DHCP existentes se actualizan solo si la capacidad del modelo es expl?citamente true; de lo contrario, se rechaza el cambio antes de escribir. No se crean delegaciones innecesarias.

Al terminar se verifica modo, VLAN, todos los mapeos LAN de Bridge y conservaci?n de las l?neas de gesti?n. Solo una verificaci?n satisfactoria actualiza operationMode y appliedVersion. Los fallos dejan applyStatus=ERROR y conservan el ?ltimo modo aplicado en BD; changed indica que pudo existir modificaci?n parcial. El modo observado puede consultarse mediante GET. No hay rollback autom?tico ni reautorizaci?n de respaldo.

La reprovisi?n existente delega los cambios de modo ZTE en esta misma operaci?n antes de guardar el resto de par?metros.

## Validaci?n de hardware pendiente

Las pruebas automatizadas usan sesiones simuladas. Antes de considerar validado el comportamiento ?ptico y de tr?fico, probar en una ZTE C320 con ONUs de uno y varios puertos: alta Bridge, Bridge a Router y Router a Bridge; comprobar tr?fico de Internet, registro ?ptico, transporte y gesti?n TR-069. Puede existir una interrupci?n breve de Internet durante el intercambio OMCI.
