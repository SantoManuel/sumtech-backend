export interface OltConnectionParams {
  host: string;
  port: number;
  username: string;
  password: string;
  enablePassword?: string;
  timeoutMs?: number;
}

export interface OltSystemInfo {
  vendor: string;
  model: string;
  uptime: string;
  firmwareVersion?: string;
  rawSystemGroup?: string;
}

export interface DiscoveredCard {
  slot: number;
  cardType: string;
  realType?: string;
  portCount: number;
  hardVer?: string;
  softVer?: string;
  status: string;
}

/** VLAN real encontrada por `getVlanConfigForInterface` -- ver `vlanDiscovery` en OltDriverCapabilities. */
export interface DiscoveredInterfaceVlan {
  vlanId: number;
  mode: 'TAG' | 'UNTAG';
}

/**
 * Perfil TCONT real encontrado por `getTcontProfiles` -- ver `tcontDiscovery`
 * en OltDriverCapabilities. `speedKbps` es `max(fbwKbps, abwKbps, mbwKbps)`,
 * confirmado contra los ejemplos del manual oficial del C320 (Tabla 2-5):
 * la velocidad "nombrada" de un perfil siempre coincide con ese máximo, sin
 * importar el `type`.
 */
export interface DiscoveredTcontProfile {
  name: string;
  type: number;
  fbwKbps: number;
  abwKbps: number;
  mbwKbps: number;
  speedKbps: number;
}

export interface DiscoveredInterface {
  name: string; // ej: 'gpon-olt_1/1/1', 'gei_1/3/1'
  type: 'PON' | 'UPLINK' | 'DOWNLINK' | 'MGMT';
  slot: number;
  port: number;
  adminState: 'UP' | 'DOWN';
  operState: 'UP' | 'DOWN';
  registeredOnus?: number;
  inputBps?: number;
  outputBps?: number;
}

export interface ConfigureVlanParams {
  interfaceName: string;
  vlanId: number;
  mode: 'TAG' | 'UNTAG';
}

export interface DiscoveredUncfgOnu {
  ponInterface: string; // ej. 'gpon-olt_1/1/1'
  onuIndex: string; // ej. 'gpon-onu_1/1/1:1' o '1'
  serialNumber: string;
  vendor?: string;
}

/**
 * ONU ya autorizada/aprovisionada EN LA OLT (por Sumtech o por otro sistema
 * de gestión) -- distinto de DiscoveredUncfgOnu (ONUs sin vincular). Pensado
 * para importar de forma pasiva el inventario de un sitio que ya tenía
 * clientes en producción antes de migrar a Sumtech, sin re-emitir el CLI de
 * autorización (ver getAuthorizedOnus en OltDriverCapabilities).
 */
export interface DiscoveredAuthorizedOnu {
  ponInterface: string; // ej. 'gpon-olt_1/2/1'
  onuIndex: string; // ej. 'gpon-onu_1/2/1:2'
  serialNumber: string;
  vendor?: string;
  onuType?: string; // modelo/tipo real reportado por la OLT, ej. 'EG8141A5'
  adminState: 'ENABLE' | 'DISABLE';
  phaseState?: string; // ej. 'working' | 'ready' | 'OffLine' | 'LOS' | 'DyingGasp'
}

export interface OltSystemHealth {
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  temperatureCelsius?: number;
  uptimeSeconds?: number;
  raw?: string;
}

/** Mismo shape que `OltMetricEntity.alarmsInfo` -- se persiste tal cual. */
export interface OltAlarm {
  level: string;
  code: string;
  description: string;
  timestamp?: string;
  target?: string;
}

export interface OnuOpticalPower {
  rxDbm?: number;
  txDbm?: number;
  downRxDbm?: number;
  upRxDbm?: number;
  attenuationDb?: number;
  raw?: string;
}

export interface TcontProfile {
  name: string;
  /** Ancho de banda FIJO (upstream) en kbps — tipo DBA 1 (fixed), el único que modela hoy `net.olt_speed_profiles`. */
  fixedKbps: number;
}

export interface TrafficProfile {
  name: string;
  /** Ancho de banda de BAJADA (downstream) en kbps, aplicado como CIR=PIR del traffic-profile (ver `downstreamTrafficProfile` en OltDriverCapabilities). */
  downKbps: number;
}

/**
 * Perfil de capacidades OMCI ("onu-type") que la OLT exige tener registrado
 * ANTES de poder autorizar un modelo de ONU -- ver `onuTypeProfileProvisioning`
 * en OltDriverCapabilities. `ethPorts`/`potsPorts` vienen de
 * `net.onu_types.eth_ports`/`.pots_ports`; los límites OMCI (maxTcont/
 * maxGemport/etc.) usan los mismos valores genéricos 8/32/8/8 que ya traían
 * los perfiles Huawei preexistentes en OLT_Tabara_Abajo (no hay forma de
 * descubrirlos por modelo real sin acceso al datasheet OMCI de cada ONU).
 */
export interface OnuTypeProfile {
  name: string;
  ethPorts?: number;
  potsPorts?: number;
}

export interface VlanTranslationParams {
  interfaceName: string;
  /** VLAN que llega del lado del cliente/ONU (interior). */
  customerVlanId: number;
  /** VLAN hacia la que se traduce del lado de la red/uplink (exterior). */
  networkVlanId: number;
}

export interface AuthorizeOnuParams {
  ponInterface: string; // ej. 'gpon-olt_1/1/1'
  onuId: number; // 1-128
  modelTypeName: string; // ej. 'ZTE-F660'
  /** Puertos ETH del Tipo de ONU (net.onu_types.eth_ports) -- usado para auto-crear el "onu-type" en la OLT si no existe (ver `onuTypeProfileProvisioning` en OltDriverCapabilities). */
  ethPorts?: number;
  /** Puertos POTS del Tipo de ONU (net.onu_types.pots_ports) -- mismo propósito que ethPorts. */
  potsPorts?: number;
  serialNumber: string;
  clientName?: string;
  /** Identificación legible en la propia OLT (zona/GPS/fecha de autorización) -- ver docs/onu-tr069-provisioning-zte-c320.md. Autogenerada por el frontend, editable antes de autorizar. */
  description?: string;
  serviceVlan: number;
  tcontProfile?: string;
  /** Nombre del traffic-profile de bajada (`net.olt_speed_profiles.vendor_traffic_profile`) -- ver `downstreamTrafficProfile` en OltDriverCapabilities. */
  trafficProfile?: string;
  downKbps?: number;
  upKbps?: number;
  managementMethod: 'OMCI' | 'TR069';
  operationMode: 'ROUTER' | 'BRIDGE';
  tr069Url?: string;
  tr069Vlan?: number;
  /** Credenciales HTTP Basic que el propio ONT debe usar para validar al ACS
   * (comando OMCI "tr069-mgmt ... validate basic username/password") --
   * confirmado en vivo (2026-10-22) en el running-config real de un cliente
   * funcionando (X2251/HWTCBC05BF9C, provisionado por SmartOLT). Opcional:
   * si la red TR-069 no tiene credenciales configuradas, se omite la
   * cláusula "validate" por completo (mismo comportamiento de antes). */
  tr069AcsUsername?: string;
  tr069AcsPassword?: string;
}

/**
 * Refleja qué operaciones de IOltDriver tienen comunicación real implementada
 * contra el hardware para este fabricante. `false` en cualquier campo significa
 * que la operación existe en la interfaz pero el driver aún no la implementó de
 * verdad (ver DriverNotImplementedError) — nunca implica que la operación "no
 * aplica", sino que todavía no hay evidencia real del equipo para construirla.
 */
export interface OltDriverCapabilities {
  testConnection: boolean;
  systemInfo: boolean;
  systemHealth: boolean;
  chassisCards: boolean;
  discoverInterfaces: boolean;
  configureVlan: boolean;
  onuDiscovery: boolean;
  onuOpticalPower: boolean;
  onuAuthorize: boolean;
  onuAdminState: boolean;
  onuDelete: boolean;
  interfaceAdminState: boolean;
  /**
   * Crear/consultar perfiles DBA-TCONT como objetos reales en la OLT (no
   * solo referenciarlos por nombre). Para ZTE, CONFIRMADO EN VIVO contra
   * OLT_Tabara_Abajo (2026-10-19): se creó y eliminó limpiamente un perfil
   * de prueba con la sintaxis real (type 5 fixed/assured/maximum). Ver
   * ZteC320Driver.ensureTcontProfile().
   */
  dbaProfile: boolean;
  /**
   * Traducción de VLAN cliente↔red en una interfaz (VLAN translation /
   * Smart QinQ). Solo se confirmó el NOMBRE del comando en documentación
   * pública (`vlan-translate ingress-port`), sin el ejemplo completo de
   * sintaxis — insuficiente para implementar sin inventar argumentos, así
   * que el método sigue lanzando DriverNotImplementedError en todos los
   * drivers hasta tener evidencia completa (reconocimiento en vivo o un
   * ejemplo documentado íntegro).
   */
  vlanTranslation: boolean;
  /**
   * Consultar el log de eventos/errores real del equipo y exponerlo como
   * alarmas (`OltMetricEntity.alarmsInfo`). `false` significa que no hay
   * evidencia real todavía de un comando que devuelva esto -- nunca se debe
   * fabricar una alarma a partir de otro dato (ver olt-monitoring.service.ts).
   */
  alarms: boolean;
  /**
   * El driver manda un comando real (OMCI/CLI) que apunta la ONU al ACS
   * (GenieACS) desde la propia OLT al autorizarla, para que el equipo pueda
   * hacer su primer Inform sin configuración manual. Distinto de todas las
   * capacidades de arriba: estas son operaciones de OLT/VLAN/ancho de banda,
   * esta es específicamente sobre TR-069/WAN. `false` puede significar dos
   * cosas muy distintas según el driver (ver su `getCapabilityNotes()`):
   * "sin evidencia todavía" (ej. ZTE, que ya tiene código real sin confirmar
   * contra hardware) o "esta familia de hardware no tiene este mecanismo en
   * absoluto" (EPON — ver HiosoDriver).
   */
  tr069AutoProvisioning: boolean;
  /**
   * Descubrir e importar ONUs YA autorizadas/aprovisionadas en la OLT (por
   * Sumtech o por otro sistema) como registros ACTIVE en net.onus, sin
   * re-emitir el comando de autorización. Pensado para incorporar un sitio
   * que ya tenía clientes en producción antes de migrar a Sumtech. `false`
   * significa que no hay evidencia real todavía de los comandos necesarios
   * para este fabricante (ver getAuthorizedOnus, método opcional de
   * IOltDriver -- no todos los drivers lo implementan).
   */
  onuPassiveImport: boolean;
  /**
   * Consultar qué VLANs están REALMENTE tageadas/untagged en una interfaz
   * física de la OLT (ver `getVlanConfigForInterface`, método opcional de
   * IOltDriver) -- a diferencia de `configureVlan`, que solo escribe a
   * ciegas. Sin esto, "Catálogo de VLANs" y "Permitir VLAN Trunk" solo
   * reflejan lo que el propio Sumtech aplicó, nunca lo que ya traía un
   * equipo en producción antes de darse de alta en el ERP (mismo punto
   * ciego que ya se resolvió para MikroTik -- ver
   * Plan_Implementacion_Descubrimiento_OLT_VLANs.md).
   */
  vlanDiscovery: boolean;
  /**
   * Consultar qué perfiles TCONT (bandwidth) REALMENTE existen en la OLT,
   * vía `getTcontProfiles` (método opcional de IOltDriver) -- a diferencia
   * de `dbaProfile`/`ensureTcontProfile`, que ESCRIBE perfiles nuevos, esto
   * es puramente de lectura. Permite importar al catálogo de Sumtech
   * (`net.olt_speed_profiles`) lo que la OLT ya tiene configurado, sin
   * escribir nada en el equipo.
   */
  tcontDiscovery: boolean;
  /**
   * Crear/asegurar el "traffic-profile" (CIR/PIR) que limita el ancho de
   * banda de BAJADA (downstream) en el vport de la ONU -- distinto de
   * `dbaProfile`/TCONT, que en GPON solo gobierna la SUBIDA (ITU-T G.984).
   * Para ZTE, CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19): se
   * creó y eliminó limpiamente un perfil de prueba. Nota: el comando "show
   * traffic-profile <nombre>" documentado en el manual oficial (§7.3.11)
   * NO EXISTE en este firmware real (confirmado: %Error 20201) -- por eso
   * `ensureTrafficProfile` no hace un chequeo de existencia previo, sino
   * que confía en que redeclarar el mismo nombre es en sí mismo idempotente
   * (también confirmado en vivo). Ver ZteC320Driver.ensureTrafficProfile().
   */
  downstreamTrafficProfile: boolean;
  /**
   * Auto-crear en la OLT el "onu-type" (perfil de capacidades OMCI: max-tcont,
   * max-gemport, max-switch-perslot, max-flow-perswitch, puertos eth/pots) que
   * exige `authorizeOnu()` cuando el modelo todavía no fue registrado a mano
   * por Telnet -- hasta ahora, SIEMPRE había que crearlo manualmente antes de
   * poder autorizar un modelo nuevo (confirmado en vivo contra
   * OLT_Tabara_Abajo, 2026-10-16: `onu <id> type <X> sn <Y>` responde
   * "%Code 63904-GPONRM : Not support this ONU." si el onu-type no existe).
   * Empieza en `false` hasta verificarse en vivo, según la convención de este
   * archivo. Ver ZteC320Driver.ensureOnuTypeProfile().
   */
  onuTypeProfileProvisioning: boolean;
}

export const NO_DRIVER_CAPABILITIES: OltDriverCapabilities = {
  testConnection: false,
  systemInfo: false,
  systemHealth: false,
  chassisCards: false,
  discoverInterfaces: false,
  configureVlan: false,
  onuDiscovery: false,
  onuOpticalPower: false,
  onuAuthorize: false,
  onuAdminState: false,
  onuDelete: false,
  interfaceAdminState: false,
  dbaProfile: false,
  vlanTranslation: false,
  alarms: false,
  tr069AutoProvisioning: false,
  onuPassiveImport: false,
  vlanDiscovery: false,
  tcontDiscovery: false,
  downstreamTrafficProfile: false,
  onuTypeProfileProvisioning: false,
};

/**
 * Lanzado por un driver registrado cuya operación todavía no tiene comunicación
 * real implementada (ver `getCapabilities()`). Los servicios que llaman al
 * driver deben traducir este error a una respuesta HTTP 501 explícita — nunca
 * debe confundirse con un fallo genérico de conexión.
 */
export class DriverNotImplementedError extends Error {
  readonly code = 'DRIVER_NOT_IMPLEMENTED';

  constructor(vendor: string, operation: string) {
    super(`[${vendor}] la operación "${operation}" todavía no está implementada para este fabricante.`);
    this.name = 'DriverNotImplementedError';
  }
}

/**
 * Lanzado por OltDriverRegistry.resolve() cuando el vendor no coincide con
 * ningún driver registrado (incluye vendor vacío/indefinido). Nunca debe
 * resolverse silenciosamente a ZteC320Driver ni a ningún otro driver por defecto.
 */
export class UnknownOltVendorError extends Error {
  readonly code = 'DRIVER_NOT_FOUND';

  constructor(vendorOrModel?: string) {
    super(`No existe un driver registrado para el fabricante de OLT "${vendorOrModel || '(vacío)'}".`);
    this.name = 'UnknownOltVendorError';
  }
}

export interface IOltDriver {
  testConnection(params: OltConnectionParams): Promise<{ ok: boolean; error?: string; latencyMs?: number }>;
  getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo>;
  getSystemHealth(params: OltConnectionParams): Promise<OltSystemHealth>;
  getCards(params: OltConnectionParams): Promise<DiscoveredCard[]>;
  discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]>;
  configureVlanOnInterface(params: OltConnectionParams, config: ConfigureVlanParams): Promise<{ ok: boolean; error?: string }>;
  getUnconfiguredOnus(params: OltConnectionParams, ponInterface?: string): Promise<DiscoveredUncfgOnu[]>;
  /**
   * Lista ONUs ya autorizadas/aprovisionadas en un puerto PON (ver
   * `onuPassiveImport` en OltDriverCapabilities) -- opcional porque no todos
   * los fabricantes tienen comandos de solo lectura equivalentes todavía.
   */
  getAuthorizedOnus?(params: OltConnectionParams, ponInterface: string): Promise<DiscoveredAuthorizedOnu[]>;
  /**
   * VLANs REALES (tag/untag) ya configuradas en una interfaz física (ver
   * `vlanDiscovery` en OltDriverCapabilities) -- opcional porque no todos los
   * fabricantes tienen un comando de solo lectura equivalente confirmado.
   */
  getVlanConfigForInterface?(params: OltConnectionParams, interfaceName: string): Promise<DiscoveredInterfaceVlan[]>;
  /**
   * Perfiles TCONT REALES configurados en la OLT (ver `tcontDiscovery` en
   * OltDriverCapabilities) -- opcional porque no todos los fabricantes
   * tienen un comando de solo lectura equivalente confirmado.
   */
  getTcontProfiles?(params: OltConnectionParams): Promise<DiscoveredTcontProfile[]>;
  getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower>;
  /**
   * `warning` (opcional, solo con `ok: true`): la autorización en sí tuvo
   * éxito (ONU creada, tcont/vlan/service-port aplicados, "write" ejecutado)
   * pero un paso de MEJOR ESFUERZO no crítico falló -- hoy, en ZTE, el push
   * OMCI de "tr069-mgmt" (ver ZteC320Driver.authorizeOnu) -- mismo criterio
   * que `cpeConfigWarning` en onu-management.service.ts: nunca debe hacer
   * fallar la autorización completa, que ya dejó al ONU pasando tráfico.
   */
  authorizeOnu(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string; warning?: string }>;
  /**
   * Aplica SOLO el bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2
   * del flujo de 3 etapas (Autorizar en OLT / Aplicar Perfil TR-069 /
   * Configurar WAN-PPPoE), separado de `authorizeOnu()` para poder
   * reintentarse de forma independiente sin volver a autorizar la ONU
   * ópticamente. Asume que la ONU ya está autorizada en la OLT
   * (`authorizeOnu()` ya corrió exitosamente antes). Mismo criterio de
   * "mejor esfuerzo" que antes tenía el bloque TR-069 dentro de
   * `authorizeOnu()`: un rechazo de la OLT en este bloque se reporta como
   * `warning`, nunca lanza.
   */
  applyTr069Management(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string; warning?: string }>;
  setOnuAdminState(params: OltConnectionParams, onuTarget: string, state: 'ACTIVE' | 'BLOCKED'): Promise<{ ok: boolean; error?: string }>;
  deleteOnu(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<{ ok: boolean; error?: string }>;
  /**
   * Habilita/deshabilita administrativamente una interfaz física completa
   * (puerto PON o uplink) — distinto de `setOnuAdminState`, que opera sobre
   * un ONU individual. Apagar un puerto PON corta a TODOS los ONUs
   * conectados a ese puerto, no a uno solo — los servicios que llamen esto
   * deben tratarlo con el mismo cuidado que una operación destructiva.
   */
  setInterfaceAdminState(params: OltConnectionParams, interfaceName: string, state: 'UP' | 'DOWN'): Promise<{ ok: boolean; error?: string }>;
  /** Busca un perfil DBA-TCONT existente por nombre. Null si no existe todavía en la OLT. */
  findTcontProfileByName(params: OltConnectionParams, name: string): Promise<TcontProfile | null>;
  /** Asegura que el perfil exista con el ancho de banda indicado (idempotente: crea si falta, no duplica si ya existe). */
  ensureTcontProfile(params: OltConnectionParams, profile: TcontProfile): Promise<{ ok: boolean; error?: string }>;
  /** Asegura que el traffic-profile de BAJADA exista (idempotente) -- ver `downstreamTrafficProfile` en OltDriverCapabilities. */
  ensureTrafficProfile(params: OltConnectionParams, profile: TrafficProfile): Promise<{ ok: boolean; error?: string }>;
  /** Asegura que el "onu-type" (perfil de capacidades OMCI) exista en la OLT antes de autorizar (idempotente) -- ver `onuTypeProfileProvisioning` en OltDriverCapabilities. */
  ensureOnuTypeProfile(params: OltConnectionParams, profile: OnuTypeProfile): Promise<{ ok: boolean; error?: string }>;
  /** Traducción de VLAN cliente↔red en una interfaz (VLAN translation/QinQ) — ver `vlanTranslation` en OltDriverCapabilities sobre por qué sigue sin evidencia suficiente para implementarse. */
  configureVlanTranslation(params: OltConnectionParams, config: VlanTranslationParams): Promise<{ ok: boolean; error?: string }>;
  /** Alarmas/eventos reales del equipo (ver `alarms` en OltDriverCapabilities). */
  getAlarms(params: OltConnectionParams): Promise<OltAlarm[]>;
  /** Script CLI SOLO óptico (ONU/tcont/gemport/vport/service-port de servicio) -- ya no incluye el bloque TR-069/OMCI, ver `generateTr069ManagementScript`. */
  generateAuthorizationScript(config: AuthorizeOnuParams): string[];
  /** Script CLI del bloque OMCI que apunta la ONU al ACS (TR-069) -- ver `applyTr069Management`. Asume `config.managementMethod==='TR069' && config.tr069Url && config.tr069Vlan`. */
  generateTr069ManagementScript(config: AuthorizeOnuParams): string[];
  getRunningConfig?(params: OltConnectionParams): Promise<string>;
  getInterfaceTraffic?(params: OltConnectionParams, interfaceName: string): Promise<{ rxKbps: number; txKbps: number; rawBps?: { inputBps: number; outputBps: number } }>;
  getCapabilities(): OltDriverCapabilities;
  /**
   * Motivo específico por el que una capability está en `false`, cuando se
   * conoce (ej. "este modelo no tiene chasis modular"). Una capability sin
   * entrada aquí simplemente no tiene evidencia real todavía (el caso común:
   * "no implementado", no "no aplica") -- el llamador debe caer al mensaje
   * genérico en ese caso. Nunca se usa para capabilities en `true`.
   */
  getCapabilityNotes(): Partial<Record<keyof OltDriverCapabilities, string>>;
}

