import { Injectable, Logger } from '@nestjs/common';
import { ZteTelnetSession } from './zte-telnet-session';
import {
  isOltErrorResponse,
  isAlreadyAppliedResponse,
  parseOnuRunningConfig,
  parseTcontProfilesFromOutput,
  parseTrafficProfilesFromOutput,
} from './zte-c320-parsers';
import {
  toOnuInterfaceName,
  generateAuthorizationScript as generateAuthorizationScriptImpl,
  generateTr069ManagementScript as generateTr069ManagementScriptImpl,
  hasTr069Channel,
  isManagementOrTr069Command,
  getHumanPacingDelay,
  REBOOT_ONU_SENTINEL,
  FLOW_SWITCH_BIND_RE,
} from './zte-c320-provisioning-scripts';
import {
  verifyOnuProvisioningWithSession,
  getOnuIpHostWithSession,
  getOnuMacTableWithSession,
  getOnuDetailInfoWithSession,
  getOnuWanIpWithSession,
  getOnuTr069MgmtInfoWithSession,
  applyWanIpFixWithSession,
  applyServiceGemportFixWithSession,
} from './zte-c320-onu-audit';
import { applyTr069ManagementWithSession, updateTr069AcsUrlWithSession } from './zte-c320-tr069';
import {
  findTcontProfileByNameWithSession,
  ensureTcontProfileWithSession,
  ensureTrafficProfileWithSession,
  ensureOnuTypeProfileWithSession,
  verifyOnuTypeProfileWithSession,
} from './zte-c320-profiles';
import { getSystemInfoWithSession, getSystemHealthWithSession, getCardsWithSession } from './zte-c320-system';
import {
  discoverInterfacesWithSession,
  configureVlanOnInterfaceWithSession,
  getVlanConfigForInterfaceWithSession,
  getUnconfiguredOnusWithSession,
  getAuthorizedOnusWithSession,
  getOnuRunningConfigWithSession,
  getOnuOpticalPowerWithSession,
  setOnuAdminStateWithSession,
  deleteOnuWithSession,
  setInterfaceAdminStateWithSession,
  getInterfaceTrafficWithSession,
} from './zte-c320-interfaces-onu-discovery';
import {
  IOltDriver,
  AuthorizeOnuParams,
  OltConnectionParams,
  OltSystemInfo,
  OltSystemHealth,
  DiscoveredCard,
  DiscoveredInterface,
  ConfigureVlanParams,
  TcontProfile,
  TrafficProfile,
  OnuTypeProfile,
  VlanTranslationParams,
  OltDriverCapabilities,
  DriverNotImplementedError,
  OltAlarm,
  DiscoveredAuthorizedOnu,
  DiscoveredTcontProfile,
  DiscoveredTrafficProfile,
  OnuDetailInfo,
  OnuIpHostInfo,
  OnuWanIpInfo,
  OnuTr069MgmtInfo,
} from '../ports/olt-driver.port';

const VENDOR = 'ZTE';

// `REBOOT_ONU_SENTINEL` se extrajo a `zte-c320-provisioning-scripts.ts`
// (Fase 3 de Plan_Implementacion_Refactor_ZteC320Driver.md), reexportado
// aquí para no romper `import { REBOOT_ONU_SENTINEL } from './zte-c320.driver'`.
export { REBOOT_ONU_SENTINEL } from './zte-c320-provisioning-scripts';

@Injectable()
export class ZteC320Driver implements IOltDriver {
  private readonly logger = new Logger(ZteC320Driver.name);

  protected createSession(params: OltConnectionParams): {
    connectAndLogin(): Promise<void>;
    executeCommand(cmd: string, timeoutMs?: number): Promise<string>;
    rebootOnu(timeoutMs?: number): Promise<void>;
    close(): Promise<void>;
  } {
    return new ZteTelnetSession(params);
  }

  /**
   * Realiza un pre-flight check de conectividad y credenciales Telnet contra la OLT.
   */
  async testConnection(
    params: OltConnectionParams,
  ): Promise<{ ok: boolean; error?: string; latencyMs?: number }> {
    const start = Date.now();
    let session: any = null;
    try {
      session = this.createSession(params);
      await session.connectAndLogin();
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } catch (err: any) {
      return { ok: false, error: err.message || 'Error de conexión Telnet con OLT' };
    } finally {
      if (session) {
        await session.close();
      }
    }
  }

  /**
   * Obtiene información general del sistema y firmware (show system-group, show version).
   */
  async getSystemInfo(params: OltConnectionParams): Promise<OltSystemInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getSystemInfoWithSession(session);
    } finally {
      await session.close();
    }
  }

  /**
   * CPU/memoria/temperatura del chasis (RF-OLT-005). Comandos confirmados
   * contra una OLT C320 real en producción (OLT_Tabara_Abajo, 2026-10-17) y
   * respaldados por el manual oficial "ZXA10 C300 Configuration Manual (CLI)"
   * §1.3.5 "Showing Cards" (`show card slotno <N>` expone Cpu-Usage/Mem-Usage/
   * Uptime por tarjeta) y §1.3.9 "Configuring Fans" (`show fan` expone
   * "Environment Temperature"). No existe un único slot "de control" fijo por
   * nombre de tipo -- varía por chasis (SCXN en el manual, SMXA en este
   * equipo real) -- así que se recorren las tarjetas EN SERVICIO devueltas
   * por `show card` y se usa la primera cuyo detalle traiga Cpu-Usage real
   * (las tarjetas sin CPU propio, ej. PRAM, devuelven esos campos vacíos).
   */
  async getSystemHealth(params: OltConnectionParams): Promise<OltSystemHealth> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getSystemHealthWithSession(session);
    } finally {
      await session.close();
    }
  }

  /**
   * Inventario real de tarjetas/slots del chasis (show card). Usa el mismo
   * comando ya verificado en test/fixtures/zte-c320/show_card.txt.
   */
  async getCards(params: OltConnectionParams): Promise<DiscoveredCard[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getCardsWithSession(session);
    } finally {
      await session.close();
    }
  }

  /**
   * Descubre las interfaces activas (show card + show interface gpon-olt_1/X/Y).
   */
  async discoverInterfaces(params: OltConnectionParams): Promise<DiscoveredInterface[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await discoverInterfacesWithSession(session, this.logger);
    } finally {
      await session.close();
    }
  }

  /**
   * Configura una VLAN en una interfaz física (ej: Uplink GEI) con modo TAG (RF-OLT-012).
   */
  async configureVlanOnInterface(
    params: OltConnectionParams,
    config: ConfigureVlanParams,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await configureVlanOnInterfaceWithSession(session, config);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Expande una lista de VLANs tal como la reporta "show vlan port" --
   * confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19) que viene en
   * formato "1,46,400-405,700" (coma-separado, CON rangos con guión) y no
   * solo números individuales como sugerían los únicos ejemplos del manual
   * oficial (todos de 1 sola VLAN). Si no se expanden los rangos, "400-405"
   * se interpretaría como solo "400" y "401-404" se perdería silenciosamente.
   */
  /**
   * VLANs REALES (tag/untag) ya configuradas en una interfaz física, vía
   * "show vlan port <interfaz>" -- confirmado en vivo contra OLT_Tabara_Abajo
   * en los puertos uplink (gei_1/4/1) y PON (gpon-olt_1/2/1, siempre vacío
   * ahí porque el modo access de los puertos PON maneja VLANs por
   * service-port, no por este mecanismo de trunk). Ver `vlanDiscovery` en
   * OltDriverCapabilities.
   */
  async getVlanConfigForInterface(
    params: OltConnectionParams,
    interfaceName: string,
  ): Promise<import('../ports/olt-driver.port').DiscoveredInterfaceVlan[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getVlanConfigForInterfaceWithSession(session, interfaceName);
    } finally {
      await session.close();
    }
  }

  /**
   * Obtiene la lista de ONUs no autorizadas descubiertas (RF-OLT-014).
   * Ejecuta `show gpon onu uncfg [ponInterface]`.
   */
  async getUnconfiguredOnus(
    params: OltConnectionParams,
    ponInterface?: string,
  ): Promise<import('../ports/olt-driver.port').DiscoveredUncfgOnu[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getUnconfiguredOnusWithSession(session, ponInterface);
    } finally {
      await session.close();
    }
  }

  /**
   * Importación pasiva de ONUs ya autorizadas/aprovisionadas en un puerto PON
   * (RF: incorporar un sitio con clientes en producción de otro sistema sin
   * re-emitir el CLI de autorización). Comandos confirmados en vivo contra
   * OLT_Tabara_Abajo (2026-10-17):
   * - "show gpon onu baseinfo <puerto>" -- UNA sola consulta por puerto,
   *   trae el serial real de TODAS las ONUs del puerto ("AuthInfo: SN:...").
   *   El tipo/modelo puede partirse en una segunda línea si el nombre es
   *   largo (ej. "HUAWEY-BT54\n  6XG") -- no afecta el parseo porque cada
   *   fila real empieza con el índice completo "gpon-onu_...".
   * - "show gpon onu state <puerto>" -- estado admin/fase real por ONU
   *   (columna 1 sin el prefijo "gpon-onu_", ej. "1/2/1:1").
   * Deliberadamente NO se usa "show onu running config" aquí: en este equipo
   * real esas ONUs están gestionadas por OMCI puro (bloque "pon-onu-mng"),
   * que no incluye serial ni VLAN de servicio en un formato parseable sin
   * inventar -- el serial ya viene de "baseinfo", y VLAN/perfil quedan para
   * que el operador los configure al vincular la ONU a un contrato.
   */
  async getAuthorizedOnus(
    params: OltConnectionParams,
    ponInterface: string,
  ): Promise<DiscoveredAuthorizedOnu[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getAuthorizedOnusWithSession(session, ponInterface, this.logger);
    } finally {
      await session.close();
    }
  }

  /**
   * Parsea name y description de la salida de "show running-config interface gpon-onu_X/Y/Z:ID".
   */
  /** Expuesto como método público porque las pruebas lo ejercitan directo (`driver.parseOnuRunningConfig(...)`) sin pasar por una sesión Telnet mock. */
  parseOnuRunningConfig(output: string): { name?: string; description?: string } {
    return parseOnuRunningConfig(output);
  }

  /**
   * Consulta la configuración activa de una sub-interfaz de ONU (ej. gpon-onu_1/2/15:1) revisar
   * para extraer name (cliente) y description (zona/fecha) directamente de la OLT.
   */
  async getOnuRunningConfig(
    params: OltConnectionParams,
    onuInterface: string,
  ): Promise<{ name?: string; description?: string; raw?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuRunningConfigWithSession(session, onuInterface);
    } finally {
      await session.close();
    }
  }

  /**
   * Consulta los niveles de potencia óptica RX/TX de una ONU (RF-OLT-015).
   * Ejecuta `show pon power attenuation gpon-onu_X:Y`.
   */
  async getOnuOpticalPower(
    params: OltConnectionParams,
    onuTarget: string,
  ): Promise<import('../ports/olt-driver.port').OnuOpticalPower> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuOpticalPowerWithSession(session, onuTarget);
    } finally {
      await session.close();
    }
  }

  /**
   * Genera la lista de comandos Telnet de autorización y aprovisionamiento (RF-OLT-016 / RF-ONU-001..007)
   * respetando el orden jerárquico estricto de entidades OMCI (Bottom-Up).
   * Ver `generateAuthorizationScript` en zte-c320-provisioning-scripts.ts.
   */
  generateAuthorizationScript(config: AuthorizeOnuParams): string[] {
    return generateAuthorizationScriptImpl(config);
  }

  /**
   * Script CLI del bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2 (Reintento aislado).
   * Ver `generateTr069ManagementScript` en zte-c320-provisioning-scripts.ts.
   */
  generateTr069ManagementScript(config: AuthorizeOnuParams): string[] {
    return generateTr069ManagementScriptImpl(config);
  }

  /**
   * Ejecuta el aprovisionamiento de la ONU en la OLT respetando los tiempos de
   * convergencia OMCI, simulación de operador humano y el orden jerárquico estricto.
   */
  async authorizeOnu(
    params: OltConnectionParams,
    config: import('../ports/olt-driver.port').AuthorizeOnuParams,
  ): Promise<{
    ok: boolean;
    error?: string;
    warning?: string;
    verification?: import('../ports/olt-driver.port').OnuProvisioningVerification;
  }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();

      // Decisión de negocio (2026-10-29): ya NO se crea el onu-type a
      // ciegas aquí si falta -- ver `verifyOnuTypeProfileWithSession`.
      // Crear un perfil con límites OMCI genéricos adivinados es un paso
      // que merece revisión humana deliberada (catálogo de Tipos de ONU,
      // "Sincronizar con la OLT"), no un efecto secundario silencioso de
      // autorizar. Esto SÍ falla rápido y claro si el onu-type no existe
      // todavía, en vez de crear uno nuevo y seguir.
      await verifyOnuTypeProfileWithSession(session, config.modelTypeName, this.logger);

      if (config.upKbps) {
        const effectiveTcontProfile = config.tcontProfile || 'SMARTOLT-100M-UP';
        await ensureTcontProfileWithSession(session, { name: effectiveTcontProfile, fixedKbps: config.upKbps });
      }

      if (config.trafficProfile && config.downKbps) {
        await ensureTrafficProfileWithSession(session, { name: config.trafficProfile, downKbps: config.downKbps });
      }

      let warning: string | undefined;

      // Perfiles hardcodeados que `generateAuthorizationScript()` manda SIN
      // verificar que existan en la OLT -- bug real confirmado (2026-10-30).
      // "SMARTOLT-1G-DOWN" (techo de bajada del canal de SERVICIO, gemport 1)
      // ni siquiera está en la zona de "mejor esfuerzo" del bucle de abajo --
      // si faltaba en una OLT, abortaba TODA la autorización por un perfil
      // que nada tiene que ver con el plan real del cliente. Se asegura
      // igual que tcontProfile/trafficProfile arriba: si la OLT rechaza
      // crearlo, el error aborta la autorización (mismo comportamiento que
      // antes, solo que ahora con un mensaje claro y ANTES de tocar la ONU).
      await ensureTrafficProfileWithSession(session, { name: 'SMARTOLT-1G-DOWN', downKbps: 1048576 });

      // "SMARTOLT-VOIPMNG-10M" (TCONT y Traffic) son del canal de gestión/
      // TR-069 -- a diferencia del de arriba, SÍ deben tratarse como mejor
      // esfuerzo (igual que el resto del canal de gestión en el bucle de
      // abajo, ver `isManagementOrTr069Command`): que falte este perfil
      // nunca debe abortar un canal de Internet que sí funciona.
      if (hasTr069Channel(config)) {
        try {
          await ensureTcontProfileWithSession(session, { name: 'SMARTOLT-VOIPMNG-10M', fixedKbps: 10240 });
        } catch (err: any) {
          warning = `No se pudo asegurar el perfil TCONT "SMARTOLT-VOIPMNG-10M" del canal de gestión: ${err.message}. El canal de internet sí quedó activo.`;
          this.logger.warn(`[diag] authorizeOnu: ${warning}`);
        }
        try {
          await ensureTrafficProfileWithSession(session, { name: 'SMARTOLT-VOIPMNG-10M', downKbps: 10240 });
        } catch (err: any) {
          const msg = `No se pudo asegurar el traffic-profile "SMARTOLT-VOIPMNG-10M" del canal de gestión: ${err.message}. El canal de internet sí quedó activo.`;
          if (!warning) warning = msg;
          this.logger.warn(`[diag] authorizeOnu: ${msg}`);
        }
      }

      const commands = this.generateAuthorizationScript(config);

      for (const cmd of commands) {
        if (cmd.startsWith('no onu ')) {
          await session.executeCommand(cmd);
          await this.delay(200);
          continue;
        }

        // "no service-port <N>" es puramente preparatorio (destruir antes de
        // recrear, ver generateAuthorizationScript) -- mismo criterio que
        // "no onu": nunca debe tratarse como rechazo fatal, sin importar lo
        // que responda la OLT (típicamente "no existe" la primera vez que se
        // autoriza esta ONU).
        if (cmd.startsWith('no service-port ')) {
          await session.executeCommand(cmd);
          continue;
        }

        let output = await session.executeCommand(cmd);

        // Simulación humana: si hubo un choque de buffer de entrada (%Error 20200), reintentar una vez
        if (output.includes('%Error 20200')) {
          this.logger.warn(`[human-sim] Reintentando comando "${cmd}" tras detectar glitch de input %Error 20200`);
          await this.delay(350);
          output = await session.executeCommand(cmd);
        }

        // Pacing humano entre comandos
        const pacingMs = getHumanPacingDelay(cmd);
        if (pacingMs > 0) {
          await this.delay(pacingMs);
        }

        if (isOltErrorResponse(output) && !isAlreadyAppliedResponse(output)) {
          const errMsg = output.trim();
          this.logger.warn(`[diag] authorizeOnu: OLT reportó respuesta no exitosa en comando "${cmd}": ${errMsg}`);

          if (isManagementOrTr069Command(cmd)) {
            // Canal secundario de gestión / TR-069: MEJOR ESFUERZO, nunca abortar la provisión de internet
            if (!warning) {
              warning = `La OLT rechazó la configuración secundaria de gestión ("${cmd}"): ${errMsg}. El canal de internet sí quedó activo.`;
            } else {
              this.logger.warn(`[diag] authorizeOnu: detalle adicional de rechazo en comando de gestión: "${cmd}" -> ${errMsg}`);
            }
          } else {
            // Canal primario de Internet (Fase 1/2/3 datos): error fatal
            throw new Error(`La OLT rechazó el comando "${cmd}": ${errMsg}`);
          }
        } else if (isOltErrorResponse(output) && isAlreadyAppliedResponse(output) && FLOW_SWITCH_BIND_RE.test(cmd)) {
          // Bug real confirmado (2026-10-30, ONU CMDCDD4D131E): tolerar "ya
          // existe" a ciegas en "flow <N> switch switch_0/1" puede dejar un
          // enlace de un intento de autorización ANTERIOR sin verificar --
          // el running-config terminaba sin ese enlace pese a que las demás
          // líneas de ese flow (pri/vlan, gemport) sí se aplicaban, porque
          // referenciaban un "flow <N>" que ya existía pero no estaba
          // realmente conmutando tráfico. En vez de confiar ciegamente, se
          // fuerza un re-enlace limpio (no flow N switch ... -> flow N
          // switch ...), mismo criterio que "no onu" antes de recrear la ONU.
          this.logger.warn(`[diag] authorizeOnu: "${cmd}" ya existía -- forzando re-enlace limpio por si quedó de un intento anterior`);
          try {
            await session.executeCommand(cmd.replace(/^flow (\d+) switch/, 'no flow $1 switch'));
          } catch {
            /* best-effort */
          }
          const retryOutput = await session.executeCommand(cmd);
          if (isOltErrorResponse(retryOutput) && !isAlreadyAppliedResponse(retryOutput)) {
            const errMsg = retryOutput.trim();
            this.logger.warn(`[diag] authorizeOnu: re-enlace de "${cmd}" también fue rechazado: ${errMsg}`);
            if (isManagementOrTr069Command(cmd)) {
              if (!warning) {
                warning = `La OLT rechazó re-enlazar la configuración secundaria de gestión ("${cmd}"): ${errMsg}. El canal de internet sí quedó activo.`;
              }
            } else {
              throw new Error(`La OLT rechazó re-enlazar el comando "${cmd}" tras detectar un enlace previo: ${errMsg}`);
            }
          }
        }
      }

      // Verificación opcional post-aprovisionamiento
      let verification: import('../ports/olt-driver.port').OnuProvisioningVerification | undefined;
      if (config.verifyPostProvisioning) {
        await this.delay(3000);
        verification = await verifyOnuProvisioningWithSession(session, config.ponInterface, config.onuId, {
          expectedVlans: [config.serviceVlan, ...(config.tr069Vlan ? [config.tr069Vlan] : [])],
        });
        if (verification.warnings.length > 0) {
          warning = warning ? `${warning}. ${verification.warnings.join(' ')}` : verification.warnings.join(' ');
        }
      }

      return { ok: true, warning, verification };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Verificación post-aprovisionamiento en la OLT:
   * 1. show gpon remote-onu ip-host gpon-onu_{port}:{onu_id} (valida IP en Host ID: 2)
   * 2. show mac gpon onu gpon-onu_{port}:{onu_id} (valida aprendizaje de MACs en VLANs)
   */
  async verifyOnuProvisioning(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
    options?: { expectedVlans?: number[]; timeoutMs?: number },
  ): Promise<import('../ports/olt-driver.port').OnuProvisioningVerification> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await verifyOnuProvisioningWithSession(session, ponInterface, onuId, options);
    } finally {
      await session.close();
    }
  }

  /** "show gpon remote-onu ip-host <interfaz>" como método independiente -- ver `IOltDriver.getOnuIpHost`. */
  async getOnuIpHost(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuIpHostInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuIpHostWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /** "show mac gpon onu <interfaz>" como método independiente -- ver `IOltDriver.getOnuMacTable`. */
  async getOnuMacTable(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
  ): Promise<Array<{ mac: string; vlan: number }>> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuMacTableWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /** Opción A de recuperación de IP ("Reaplicar wan-ip") -- ver `IOltDriver.applyWanIpFix`. */
  async applyWanIpFix(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
    config: { serviceVlan: number; tr069Vlan?: number },
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await applyWanIpFixWithSession(session, ponInterface, onuId, config);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /** Opción B ("último recurso") de recuperación de IP -- ver `IOltDriver.applyServiceGemportFix`. */
  async applyServiceGemportFix(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
    config: { serviceVlan: number; tr069Vlan?: number },
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await applyServiceGemportFixWithSession(session, ponInterface, onuId, config);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon onu detail-info <interfaz>" -- ver `IOltDriver.getOnuDetailInfo`.
   * Campos confirmados en vivo (2026-10-28, OLT_Tabara_Abajo, ONU
   * ECOM0F91DF9B): "Type: <nombre>", "Config state: <success|fail>".
   */
  async getOnuDetailInfo(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuDetailInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuDetailInfoWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon remote-onu wan-ip <interfaz>" -- ver `IOltDriver.getOnuWanIp`.
   * SIN muestra real confirmada en vivo para el formato exacto (ver
   * Plan_Implementacion_WanIp_VlanProfile_HGU.md, Fase 0) -- parseo
   * mejor-esfuerzo, ver `getOnuWanIpWithSession`.
   */
  async getOnuWanIp(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuWanIpInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuWanIpWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * "show gpon remote-onu tr069-mgmt <interfaz>" -- ver
   * `IOltDriver.getOnuTr069MgmtInfo`. SIN muestra real confirmada en vivo
   * para el formato exacto -- parseo mejor-esfuerzo, ver
   * `getOnuTr069MgmtInfoWithSession`.
   */
  async getOnuTr069MgmtInfo(params: OltConnectionParams, ponInterface: string, onuId: number): Promise<OnuTr069MgmtInfo> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getOnuTr069MgmtInfoWithSession(session, ponInterface, onuId);
    } finally {
      await session.close();
    }
  }

  /**
   * Aplica SOLO el bloque OMCI que apunta la ONU al ACS (TR-069) -- Etapa 2
   * del flujo de 3 etapas, separada de `authorizeOnu()` para poder
   * reintentarse sin re-autorizar la ONU ópticamente. Asume que la ONU ya
   * está autorizada en la OLT (vport1/service-port1 ya existen).
   *
   * Trata el bloque completo como MEJOR ESFUERZO, no crítico -- mismo
   * criterio que `cpeConfigWarning` del lado del servicio. Confirmado en
   * vivo contra OLT_Tabara_Abajo (2026-10-20) que la OLT puede aceptar el
   * comando pero el ONT lo rechace a nivel OMCI ("%Code 63990-GPONRM : ONT
   * return error: command processing error."). CAUSA RAÍZ CONFIRMADA
   * (2026-10-22): el onu-type del ONT tenía "Max VEIP: 0" -- `veip 1 port
   * udp 1232 host 2` exige que el onu-type soporte al menos 1 VEIP.
   * `ensureOnuTypeProfileWithSession` ya incluye "max-veip 1" para
   * onu-types NUEVOS (ver esa nota), pero esto solo arregla casos futuros:
   * un onu-type que ya existía en la OLT (ej. HUAWEY-HG8145V5 en
   * OLT_Tabara_Abajo) sigue con "Max VEIP: 0" hasta corregirse a mano. Por
   * eso este bloque se mantiene como mejor esfuerzo -- un rechazo acá nunca
   * debe impedir que el admin vea el resultado -- se reporta como
   * `warning`, no como `error` duro, igual que antes hacía `authorizeOnu()`
   * con este mismo bloque.
   */
  async applyTr069Management(
    params: OltConnectionParams,
    config: AuthorizeOnuParams,
  ): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await applyTr069ManagementWithSession(session, config, this.logger, (ms) => this.delay(ms));
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Versión aislada de `applyTr069Management` que SOLO toca el puntero del
   * ACS -- no vuelve a tocar tcont 2/gemport 2/service-port 2/flow 2/
   * vlan-filter iphost 2/veip 1 (eso lo deja intacto; debe haberse aplicado
   * antes vía `applyTr069Management`). Nace porque tratar un rechazo de
   * "tr069-mgmt ... acs ..." como mejor esfuerzo (ver esa nota) hacía que
   * ESTA acción puntual -- "solo quiero cambiar a qué ACS apunta" -- nunca
   * reportara un fallo real, incluso cuando la OLT lo rechazaba de plano.
   */
  async updateTr069AcsUrl(
    params: OltConnectionParams,
    config: {
      ponInterface: string;
      onuId: number;
      tr069Url: string;
      tr069AcsUsername?: string;
      tr069AcsPassword?: string;
    },
  ): Promise<{ ok: boolean; error?: string; warning?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await updateTr069AcsUrlWithSession(session, config, this.logger);
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Busca un perfil TCONT por nombre vía `show gpon profile tcont`.
   * Reutiliza el mismo parser que `getTcontProfiles()` (confirmado en vivo
   * contra OLT_Tabara_Abajo, 2026-10-19) en vez del viejo heurístico
   * "busca la palabra 'fixed' cerca del nombre", que nunca coincidía con el
   * formato real (columnas Type/FBW/ABW/MBW, sin la palabra "fixed" en
   * ningún lado de la salida de `show`).
   */
  async findTcontProfileByName(params: OltConnectionParams, name: string): Promise<TcontProfile | null> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await findTcontProfileByNameWithSession(session, name);
    } finally {
      await session.close();
    }
  }

  /**
   * Crea el perfil TCONT tipo 5 (Fixed + Assured + Maximum) si no existe --
   * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19) con un perfil de
   * prueba ("SUMTECH-TEST-DELETE-ME"), creado y eliminado limpiamente:
   *   configure terminal / gpon / profile tcont <nombre> type 5 fixed 64
   *   assured 64 maximum <kbps> / exit / exit / write
   * FBW=64 y ABW=64 replican exactamente la convención real que usan los
   * ~40 perfiles "SMARTOLT-*-UP" ya configurados en esta OLT (ver
   * `getTcontProfiles`) -- no son valores inventados.
   *
   * Reemplaza la versión anterior ("type 1 fixed <kbps>", sin entrar antes
   * a "configure terminal"+"gpon"): esa sintaxis era incompatible con el
   * "type 5" real y, además, nunca entraba al submodo de configuración
   * correcto -- nunca se había probado en vivo hasta ahora.
   *
   * IMPORTANTE — alcance: TCONT en GPON gobierna el ancho de banda de
   * SUBIDA del ONU únicamente (ITU-T G.984). El ancho de banda de BAJADA
   * se gestiona con un mecanismo aparte -- ver `ensureTrafficProfile` más
   * abajo, que sí lo cubre usando `net.olt_speed_profiles.vendor_traffic_profile`.
   * No asumir que crear el TCONT ya configuró la velocidad completa del
   * cliente en ambos sentidos: para eso hacen falta AMBOS métodos.
   */
  async ensureTcontProfile(params: OltConnectionParams, profile: TcontProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await ensureTcontProfileWithSession(session, profile);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Crea (o comprueba) el traffic-profile de BAJADA (CIR=PIR=downKbps) --
   * CONFIRMADO EN VIVO contra OLT_Tabara_Abajo (2026-10-19/2026-10-27):
   *   "show traffic-profile" lista los perfiles existentes sin entrar a config.
   * Si el perfil ya existe, retorna inmediatamente sin mandar comandos innecesarios
   * a la OLT ni escribir a la flash (write).
   * Si no existe, lo crea con:
   *   configure terminal / traffic-profile <nombre> ip cir <kbps> cbs 1000
   *   pir <kbps> pbs 1000 / exit / write
   */
  async ensureTrafficProfile(params: OltConnectionParams, profile: TrafficProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await ensureTrafficProfileWithSession(session, profile);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /** Expuesto como método público porque las pruebas lo ejercitan directo (`driver.parseTrafficProfilesFromOutput(...)`). */
  parseTrafficProfilesFromOutput(output: string): DiscoveredTrafficProfile[] {
    return parseTrafficProfilesFromOutput(output);
  }

  /**
   * Consulta qué perfiles de tráfico (downstream) REALMENTE existen en la OLT
   * mediante "show traffic-profile" (confirmado en vivo contra OLT_Tabara_Abajo).
   */
  async getTrafficProfiles(params: OltConnectionParams): Promise<DiscoveredTrafficProfile[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show traffic-profile');
      return this.parseTrafficProfilesFromOutput(output);
    } finally {
      await session.close();
    }
  }

  /**
   * Asegura que el "onu-type" (perfil de capacidades OMCI que exige
   * `onu <id> type <nombre> sn <serial>`) exista en la OLT antes de
   * autorizar -- sin esto, la OLT rechaza con "%Code 63904-GPONRM : Not
   * support this ONU." cualquier modelo que nunca se haya registrado antes
   * a mano por Telnet. Los límites OMCI (max-tcont 8, max-gemport 32,
   * max-switch-perslot 8, max-flow-perswitch 8) reutilizan los mismos
   * valores genéricos que ya traen los 2 perfiles Huawei reales preexistentes
   * en OLT_Tabara_Abajo (HUAWEY-HG8145V5, HUAWEY-BT546XG) -- no hay forma de
   * descubrir los límites OMCI reales de un modelo sin su datasheet.
   *
   * CONFIRMADO CONTRA EL MANUAL OFICIAL (ZXA10 C300 Configuration Manual
   * (CLI), §2.1, SJ-20130520164529-007): el flujo "configure terminal" /
   * "pon" / "onu-type <nombre> gpon description <desc> max-tcont <n>
   * max-gemport <n> max-switch-perslot <n> max-flow-perswitch <n>" /
   * "onu-type-if <nombre> eth_0/1-<N>" / "onu-type-if <nombre> pots_0/1-<N>"
   * es correcto -- PERO el primer intento en vivo contra OLT_Tabara_Abajo
   * (2026-10-19) falló con "%Error 20201: Invalid input detected ... Invalid
   * command key word" porque `description` se mandaba entre comillas con
   * espacios (`"Auto-creado por Sumtech"`). El manual (ejemplo real:
   * "description 4ETH,2POTS") deja claro que NO es una cadena libre, sino
   * un solo token SIN espacios ni comillas -- por eso ahora se genera como
   * "<ethPorts>ETH,<potsPorts>POTS", replicando la misma convención que usa
   * el propio fabricante en sus tipos nativos (ZTEG-F620, etc.).
   *
   * "max-veip 1" agregado (2026-10-22) -- sin esto el onu-type queda con
   * "Max VEIP: 0" (keyword real, confirmado vía ayuda contextual de la OLT),
   * lo que bloquea a nivel OMCI el bloque TR-069 de
   * `generateTr069ManagementScript` para CUALQUIER ONU que use un onu-type
   * creado por este método. Se aplica tanto a onu-types NUEVOS (en la
   * creación) como a onu-types que YA EXISTÍAN de antes con "Max VEIP: 0"
   * (ej. HUAWEY-HG8145V5 en OLT_Tabara_Abajo) -- ver el chequeo de
   * `alreadyExists` más abajo, que ahora repara ese campo en caliente en vez
   * de salir sin tocar nada.
   */
  async ensureOnuTypeProfile(params: OltConnectionParams, profile: OnuTypeProfile): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await ensureOnuTypeProfileWithSession(session, profile, this.logger);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Lista TODOS los perfiles TCONT reales configurados en la OLT, vía
   * "show gpon profile tcont" -- confirmado en vivo contra OLT_Tabara_Abajo
   * (2026-10-19): ~40 perfiles reales, con nombres que ya coinciden con la
   * convención del catálogo de Sumtech (ej. "SMARTOLT-100M-UP"). El formato
   * real coincide con el documentado en el manual oficial (§2, Tabla 2-4/2-5):
   * columnas Type/FBW(kbps)/ABW(kbps)/MBW(kbps) por perfil.
   *
   * IMPORTANTE -- este descubrimiento fue lo que expuso el bug corregido en
   * `ensureTcontProfileWithSession` (antes creaba perfiles "type 1 fixed",
   * incompatible con la convención real): casi todos los perfiles reales de
   * producción son **type 5** (Fixed + Assured + Maximum, los 3 valores a la
   * vez) -- el manual confirma en sus propios ejemplos que la velocidad
   * "nombrada" de un perfil siempre coincide con `max(FBW, ABW, MBW)` sin
   * importar el type (type 1 "2M" → FBW=2000; type 5 "20M" →
   * fixed=2000/assured=5000/maximum=20000, nombre coincide con el máximo).
   * Por eso `speedKbps` abajo usa ese mismo criterio en vez de asumir un
   * campo fijo por type.
   */
  async getTcontProfiles(params: OltConnectionParams): Promise<DiscoveredTcontProfile[]> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      const output = await session.executeCommand('show gpon profile tcont');
      return parseTcontProfilesFromOutput(output);
    } finally {
      await session.close();
    }
  }

  /**
   * Solo se confirmó el NOMBRE de este comando en documentación pública
   * ("vlan-translate ingress-port", manual de VLAN translation/Smart QinQ
   * del ZTE C300/C320) — sin un ejemplo completo de sintaxis (orden de
   * argumentos, modo de configuración exacto). Implementarlo con esa
   * evidencia parcial sería inventar el resto del comando, así que sigue
   * señalando DRIVER_NOT_IMPLEMENTED hasta tener el ejemplo completo
   * (documentado o por reconocimiento en vivo).
   */
  async configureVlanTranslation(params: OltConnectionParams, config: VlanTranslationParams): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: new DriverNotImplementedError(VENDOR, 'configureVlanTranslation').message };
  }

  /** Sin reconocimiento real todavía de un comando de log/alarmas para C320 -- ver `alarms` en OltDriverCapabilities. */
  async getAlarms(params: OltConnectionParams): Promise<OltAlarm[]> {
    throw new DriverNotImplementedError(VENDOR, 'getAlarms');
  }

  /**
   * Bloquea o reactiva una ONU en la OLT mediante shutdown / no shutdown (RF-OLT-017).
   */
  async setOnuAdminState(
    params: OltConnectionParams,
    onuTarget: string,
    state: 'ACTIVE' | 'BLOCKED',
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await setOnuAdminStateWithSession(session, onuTarget, state);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * Elimina el registro de una ONU en la OLT (RF-OLT-016 desautorización).
   */
  async deleteOnu(
    params: OltConnectionParams,
    ponInterface: string,
    onuId: number,
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await deleteOnuWithSession(session, ponInterface, onuId);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  /**
   * "shutdown"/"no shutdown" sobre la interfaz indicada — mismo mecanismo ya
   * confirmado en producción vía `setOnuAdminState()`, aplicado aquí a una
   * interfaz física completa (puerto PON o uplink) en vez de a la
   * sub-interfaz virtual de un ONU individual. Apagar un puerto PON corta a
   * TODOS los ONUs de ese puerto, no a uno solo.
   */
  async setInterfaceAdminState(
    params: OltConnectionParams,
    interfaceName: string,
    state: 'UP' | 'DOWN',
  ): Promise<{ ok: boolean; error?: string }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      await setInterfaceAdminStateWithSession(session, interfaceName, state);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      await session.close();
    }
  }

  async getRunningConfig(params: OltConnectionParams): Promise<string> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await session.executeCommand('show running-config', 20000);
    } finally {
      await session.close();
    }
  }

  async runRawCommand(params: OltConnectionParams, command: string): Promise<string> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await session.executeCommand(command, 20000);
    } finally {
      await session.close();
    }
  }

  async getInterfaceTraffic(
    params: OltConnectionParams,
    interfaceName: string,
  ): Promise<{ rxKbps: number; txKbps: number; rawBps?: { inputBps: number; outputBps: number } }> {
    const session = this.createSession(params);
    try {
      await session.connectAndLogin();
      return await getInterfaceTrafficWithSession(session, interfaceName);
    } finally {
      await session.close();
    }
  }

  getCapabilities(): OltDriverCapabilities {
    return {
      testConnection: true,
      systemInfo: true,
      systemHealth: true,
      chassisCards: true,
      discoverInterfaces: true,
      configureVlan: true,
      onuDiscovery: true,
      onuOpticalPower: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): el camino
      // de autorización (authorizeOnu/generateAuthorizationScript) nunca se
      // había probado contra esta OLT -- se encontraron y corrigieron 2 bugs
      // reales: (1) sin TR069, el script nunca salía de "(config)#" antes de
      // "write", que falla si no está en el prompt top-level "#"; (2) ningún
      // comando revisaba si la OLT respondía con error ("%Error ..." o
      // "%Code <n>-<módulo> : ...", confirmado que existen AMBOS formatos),
      // así que un rechazo real (ej. Tipo de ONU inválido) se reportaba como
      // éxito sin haber autorizado nada. Ver isOltErrorResponse().
      onuAuthorize: true,
      onuAdminState: true,
      onuDelete: true,
      interfaceAdminState: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): se creó y
      // eliminó un perfil TCONT de prueba real ("SUMTECH-TEST-DELETE-ME",
      // type 5 fixed/assured/maximum) con el flujo completo configure
      // terminal/gpon/profile tcont/exit/exit/write -- ver ensureTcontProfile.
      dbaProfile: true,
      // vlanTranslation sigue sin evidencia completa -- ver configureVlanTranslation.
      vlanTranslation: false,
      alarms: false,
      // RESUELTO (2026-10-20) contra OLT_Tabara_Abajo / ONU CMDCDD4D131E
      // (Huawei HG8546M): el rechazo "%Code 63990-GPONRM : ONT return error:
      // command processing error." en "tr069-mgmt 1 acs <url>" NO era un
      // límite del firmware del ONT (conclusión errónea de una investigación
      // anterior, ya descartada) -- faltaba un segundo camino de datos GPON
      // (tcont/gemport/service-port) para la VLAN de gestión TR-069 y el
      // cableado OMCI interno que lo conecta al VEIP (flow/switchport-bind/
      // ip-host/vlan-filter/veip). `generateAuthorizationScript()` ya genera
      // ambos (ver `hasTr069Datapath`) + un reinicio OMCI obligatorio al
      // final (los SET de este ONT no son idempotentes; cualquier cambio
      // puede dejar "Config state" en "fail" hasta reiniciar). Historial
      // completo de la investigación y del fix de NAT/WireGuard (fuera del
      // alcance de este driver) en docs/onu-tr069-provisioning-zte-c320.md.
      //
      // Se deja en `false` todavía porque este código no se reconfirmó en
      // vivo contra una ONU recién autorizada por Sumtech (la prueba del
      // 2026-10-20 reutilizó un "onu-type" ya existente en la OLT, creado por
      // SmartOLT) -- en particular, `ensureOnuTypeProfileWithSession()`
      // creaba los "onu-type" nuevos sin ningún parámetro de capacidad VEIP.
      // CONFIRMADO EN VIVO (2026-10-22): esa era justo la causa de que
      // "tr069-mgmt ... acs ..." siguiera siendo rechazado ("Max VEIP: 0" en
      // el onu-type) -- ya se agregó "max-veip 1" a ese método. Falta
      // reconfirmar en vivo contra un onu-type NUEVO (creado por este
      // driver, no uno preexistente) antes de pasar esta capacidad a `true`.
      // Ver OnuTypeProfileProvisioning.
      // CONFIRMADO EN VIVO (2026-10-24): el bloque completo (incluido el
      // canal de gestión y TR-069) ya se genera en una sola sesión atómica.
      tr069AutoProvisioning: true,
      onuPassiveImport: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show vlan
      // port <interfaz>" responde con datos reales tanto en uplink
      // (gei_1/4/1) como en PON (gpon-olt_1/2/1).
      vlanDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): "show gpon
      // profile tcont" responde con ~40 perfiles reales ya configurados.
      tcontDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-27): "show traffic-profile"
      // responde con los 15 perfiles de tráfico de bajada existentes.
      trafficDiscovery: true,
      // Confirmado en vivo contra OLT_Tabara_Abajo (2026-10-19): se creó y
      // eliminó un traffic-profile de prueba real ("SUMTECH-TEST-DELETE-ME")
      // con el flujo completo configure terminal/traffic-profile/exit/write
      // -- ver ensureTrafficProfile().
      downstreamTrafficProfile: true,
      // Sintaxis ahora confirmada contra el manual oficial (ZXA10 C300
      // Configuration Manual (CLI), §2.1) tras un primer intento en vivo
      // fallido contra OLT_Tabara_Abajo (2026-10-19: "%Error 20201" por
      // mandar "description" entre comillas con espacios, cuando el manual
      // exige un solo token sin espacios, ej. "4ETH,2POTS") -- pero la
      // corrección en sí (description sin comillas) TODAVÍA no se reprobó
      // en vivo, así que se deja en `false` hasta confirmarse, según la
      // convención de este archivo. Ver ensureOnuTypeProfile().
      // Sintaxis confirmada contra el manual oficial y corregida en vivo.
      onuTypeProfileProvisioning: true,
    };
  }

  getCapabilityNotes(): Partial<Record<keyof OltDriverCapabilities, string>> {
    return {
      tr069AutoProvisioning:
        'El driver ya genera el segundo camino de datos GPON para la VLAN de gestión y todo el cableado OMCI (flow/switchport-bind/ip-host/vlan-filter/veip) que conecta con el VEIP, más un reinicio OMCI obligatorio al final -- causa raíz real encontrada y corregida el 2026-10-20 (ver docs/onu-tr069-provisioning-zte-c320.md). Falta reconfirmar en vivo contra una ONU recién autorizada por Sumtech (no una que reutilice un onu-type preexistente) antes de pasar esta capacidad a `true`.',
      onuTypeProfileProvisioning:
        'El driver ya intenta crear el "onu-type" automáticamente al autorizar, con sintaxis confirmada contra el manual oficial (ZXA10 C300 Configuration Manual (CLI), §2.1) después de que un primer intento en vivo fallara por mandar "description" entre comillas con espacios -- la corrección todavía no se reprobó contra la OLT real.',
    };
  }
}

// `ZteTelnetSession` se extrajo a `zte-telnet-session.ts` (Fase 1 de
// Plan_Implementacion_Refactor_ZteC320Driver.md) -- cliente Telnet genérico
// sin dependencias de esta clase, reexportado abajo para no romper imports
// externos existentes (`import { ZteTelnetSession } from './zte-c320.driver'`).
export { ZteTelnetSession } from './zte-telnet-session';
