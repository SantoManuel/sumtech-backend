/**
 * Capacidades IPv6 reales a nivel de CPE (ONT/router de abonado) gestionado
 * vía TR-069 (GenieACS) -- Fase 2 y Fase 3.0 de Plan_Implementacion_IPv6_Dual_Stack_WAN.md.
 *
 * Mismo principio de diseño y filosofía que `OltDriverCapabilities` y `capabilityNotes`
 * en `src/modules/olt/ports/olt-driver.port.ts`: nunca declarar soportada una
 * operación sin evidencia en vivo en el hardware real en uso (Huawei HG8546M,
 * ZTE F660/F670, clanes CMDC, etc.).
 */

export interface CpeIpv6Capabilities {
  /**
   * Flag de activación IPv6 en modo PPPoE (ej. `IPv6CPEnable` en TR-181 o
   * `X_BROADCOM_COM_IPv6PrefixDelegationEnabled` en TR-098). Ya activo hoy.
   */
  pppoeDualStack: boolean;

  /**
   * Confirmación y lectura (readback) del prefijo delegado y dirección WAN IPv6
   * asignados tras la negociación IPv6CP en vivo.
   */
  pppoePrefixReadback: boolean;

  /**
   * Soporte de Dual-Stack IPv4/IPv6 en modo DHCP (activación de cliente
   * DHCPv6 / SLAAC en WANIPConnection o Device.DHCPv6.Client).
   */
  dhcpDualStack: boolean;

  /**
   * Soporte de direccionamiento estático IPv6 (dirección, prefijo, gateway y
   * DNS IPv6 manuales en WANIPConnection o Device.IP.Interface).
   */
  staticIpv6: boolean;
}

export type CpeIpv6CapabilityNotes = Partial<Record<keyof CpeIpv6Capabilities, string>>;

export interface CpeIpv6Profile {
  vendor: string;
  capabilities: CpeIpv6Capabilities;
  notes: CpeIpv6CapabilityNotes;
}

/**
 * Matriz de capacidades por fabricante / modelo / estándar según la evidencia
 * recabada en Fase 2 (ver `sumtech-backend/docs/onu-tr069-provisioning-zte-c320.md`
 * y árbol de 183 parámetros capturado en vivo en ONT CMDCDD4D131E / Huawei HG8546M).
 */
export const CPE_IPV6_CAPABILITY_PROFILES: Record<string, CpeIpv6Profile> = {
  // Modelos Huawei y clones CMDC (HG8546M, HG8145V5, etc.) con TR-098
  HUAWEI: {
    vendor: 'HUAWEI',
    capabilities: {
      pppoeDualStack: true,
      pppoePrefixReadback: true,
      dhcpDualStack: false,
      staticIpv6: false,
    },
    notes: {
      dhcpDualStack:
        'El firmware TR-098 de este fabricante no expone WANIPv6Connection estándar ni parámetros DHCPv6 verificados en vivo contra hardware de este tenant.',
      staticIpv6:
        'El firmware TR-098 de este fabricante no expone campos estándar de dirección, prefijo y gateway IPv6 en WANIPConnection.',
    },
  },

  // Modelos ZTE (F660, F670, ZXHN, etc.) con TR-098
  ZTE: {
    vendor: 'ZTE',
    capabilities: {
      pppoeDualStack: true,
      pppoePrefixReadback: true,
      dhcpDualStack: false,
      staticIpv6: false,
    },
    notes: {
      dhcpDualStack:
        'El firmware TR-098 de ZTE no expone WANIPv6Connection estándar ni parámetros DHCPv6 verificados en vivo en este tenant.',
      staticIpv6:
        'El firmware TR-098 de ZTE no expone campos estándar de direccionamiento IPv6 estático en WANIPConnection.',
    },
  },

  // Perfil TR-181 (Device:2) estandarizado por Broadband Forum
  TR181: {
    vendor: 'TR181',
    capabilities: {
      pppoeDualStack: true,
      pppoePrefixReadback: true,
      dhcpDualStack: true,
      staticIpv6: true,
    },
    notes: {},
  },

  // Perfil por defecto (TR-098 genérico / fabricante desconocido)
  GENERIC_TR098: {
    vendor: 'GENERIC_TR098',
    capabilities: {
      pppoeDualStack: true,
      pppoePrefixReadback: true,
      dhcpDualStack: false,
      staticIpv6: false,
    },
    notes: {
      dhcpDualStack:
        'No soportado: el modelo TR-098 estándar no incluye DHCPv6 en WANIPConnection y este CPE no tiene extensión confirmada.',
      staticIpv6:
        'No soportado: el modelo TR-098 estándar no incluye parámetros IPv6 estáticos en WANIPConnection.',
    },
  },
};

/**
 * Resuelve las capacidades IPv6 de un CPE dado su fabricante, modelo y versión de estándar.
 */
export function resolveCpeIpv6Capabilities(
  vendor?: string,
  model?: string,
  isTR181?: boolean,
): { capabilities: CpeIpv6Capabilities; notes: CpeIpv6CapabilityNotes } {
  if (isTR181) {
    return {
      capabilities: { ...CPE_IPV6_CAPABILITY_PROFILES.TR181.capabilities },
      notes: { ...CPE_IPV6_CAPABILITY_PROFILES.TR181.notes },
    };
  }

  const v = (vendor || '').toUpperCase().trim();
  const m = (model || '').toUpperCase().trim();

  if (v.includes('HUAWEI') || v.includes('CMDC') || m.includes('HG8546') || m.includes('HG8145')) {
    return {
      capabilities: { ...CPE_IPV6_CAPABILITY_PROFILES.HUAWEI.capabilities },
      notes: { ...CPE_IPV6_CAPABILITY_PROFILES.HUAWEI.notes },
    };
  }

  if (v.includes('ZTE') || m.includes('F660') || m.includes('F670') || m.includes('ZXHN')) {
    return {
      capabilities: { ...CPE_IPV6_CAPABILITY_PROFILES.ZTE.capabilities },
      notes: { ...CPE_IPV6_CAPABILITY_PROFILES.ZTE.notes },
    };
  }

  return {
    capabilities: { ...CPE_IPV6_CAPABILITY_PROFILES.GENERIC_TR098.capabilities },
    notes: { ...CPE_IPV6_CAPABILITY_PROFILES.GENERIC_TR098.notes },
  };
}
