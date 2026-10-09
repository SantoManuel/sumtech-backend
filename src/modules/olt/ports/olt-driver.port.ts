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

export interface OltSystemHealth {
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  temperatureCelsius?: number;
  uptimeSeconds?: number;
  raw?: string;
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
  serialNumber: string;
  clientName?: string;
  serviceVlan: number;
  tcontProfile?: string;
  downKbps?: number;
  upKbps?: number;
  managementMethod: 'OMCI' | 'TR069';
  operationMode: 'ROUTER' | 'BRIDGE';
  tr069Url?: string;
  tr069Vlan?: number;
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
   * solo referenciarlos por nombre). Para ZTE la sintaxis sale de
   * documentación pública oficial del C320 (no de reconocimiento en vivo
   * contra un equipo propio) — por eso esta capacidad se mantiene en
   * `false` hasta confirmarlo contra hardware real, aunque el método ya
   * tenga lógica funcional. Ver ZteC320Driver.ensureTcontProfile().
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
  getOnuOpticalPower(params: OltConnectionParams, onuTarget: string): Promise<OnuOpticalPower>;
  authorizeOnu(params: OltConnectionParams, config: AuthorizeOnuParams): Promise<{ ok: boolean; error?: string }>;
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
  /** Traducción de VLAN cliente↔red en una interfaz (VLAN translation/QinQ) — ver `vlanTranslation` en OltDriverCapabilities sobre por qué sigue sin evidencia suficiente para implementarse. */
  configureVlanTranslation(params: OltConnectionParams, config: VlanTranslationParams): Promise<{ ok: boolean; error?: string }>;
  generateAuthorizationScript(config: AuthorizeOnuParams): string[];
  getCapabilities(): OltDriverCapabilities;
}

