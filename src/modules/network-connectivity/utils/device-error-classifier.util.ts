import { NetErrorCode } from '../enums/net-error-code.enum';

export interface ClassifiedDeviceError {
  code: NetErrorCode;
  message: string;
  details?: string;
  rawError?: unknown;
}

const ERROR_MESSAGES_ES: Record<NetErrorCode, string> = {
  [NetErrorCode.NET_DEVICE_OFFLINE]: 'El equipo se encuentra fuera de línea o inaccesible en la red.',
  [NetErrorCode.NET_TIMEOUT]: 'Tiempo de espera agotado al comunicarse con el equipo.',
  [NetErrorCode.NET_AUTH_INVALID]: 'Credenciales de acceso inválidas o usuario/contraseña incorrectos.',
  [NetErrorCode.NET_PORT_UNREACHABLE]: 'El puerto de administración del equipo no es alcanzable.',
  [NetErrorCode.NET_CONNECTION_REFUSED]: 'Conexión rechazada por el equipo (servicio no habilitado o puerto cerrado).',
  [NetErrorCode.NET_DNS_RESOLUTION]: 'No se pudo resolver el nombre de host DDNS o dominio del equipo.',
  [NetErrorCode.NET_NO_ROUTE]: 'No existe ruta de red hacia la dirección del equipo.',
  [NetErrorCode.NET_VPN_DOWN]: 'El túnel VPN hacia el equipo se encuentra caído.',
  [NetErrorCode.NET_WG_HANDSHAKE_STALE]: 'El túnel WireGuard no ha completado el saludo (handshake) reciente.',
  [NetErrorCode.NET_TLS_ERROR]: 'Error de negociación TLS/SSL con el equipo o certificado inválido.',
  [NetErrorCode.NET_PERMISSION_DENIED]: 'Permisos insuficientes en el equipo para ejecutar la acción solicitada.',
  [NetErrorCode.NET_UNSUPPORTED_VERSION]: 'La versión del sistema operativo del equipo no es compatible.',
  [NetErrorCode.NET_MISSING_FEATURE]: 'El equipo no tiene instalado o habilitado el paquete/funcionalidad requerida.',
  [NetErrorCode.NET_COMMAND_ERROR]: 'Error en la sintaxis o ejecución del comando en el equipo.',
  [NetErrorCode.NET_TARGET_NOT_FOUND]: 'El recurso o entidad de red solicitada no existe en el equipo.',
  [NetErrorCode.NET_CONFIG_ERROR]: 'Error de configuración en los parámetros del equipo.',
  [NetErrorCode.NET_UNKNOWN]: 'Error desconocido al comunicarse con el equipo.',
};

/**
 * Clasifica cualquier error proveniente de capas de red (Axios, sockets TCP,
 * RouterOS API, SSH o Telnet ZTE) en un código NetErrorCode canónico con
 * descripción en español (RF-RED-004).
 */
export function classifyDeviceError(error: any): ClassifiedDeviceError {
  if (!error) {
    return {
      code: NetErrorCode.NET_UNKNOWN,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_UNKNOWN],
    };
  }

  const rawCode = String(error.code || '').toUpperCase();
  const rawMessage = String(error.message || '');
  const status = error.response?.status;
  const responseData = typeof error.response?.data === 'string'
    ? error.response.data
    : JSON.stringify(error.response?.data || '');

  const combinedText = `${rawCode} ${rawMessage} ${responseData}`.toLowerCase();

  // 1. Timeouts
  if (
    rawCode === 'ECONNABORTED' ||
    rawCode === 'ETIMEDOUT' ||
    combinedText.includes('timeout') ||
    combinedText.includes('tiempo de espera agotado')
  ) {
    return {
      code: NetErrorCode.NET_TIMEOUT,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_TIMEOUT],
      details: rawMessage,
      rawError: error,
    };
  }

  // 2. Conexión rechazada
  if (rawCode === 'ECONNREFUSED' || combinedText.includes('connection refused')) {
    return {
      code: NetErrorCode.NET_CONNECTION_REFUSED,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_CONNECTION_REFUSED],
      details: rawMessage,
      rawError: error,
    };
  }

  // 3. Resolución DNS
  if (rawCode === 'ENOTFOUND' || combinedText.includes('getaddrinfo enotfound') || combinedText.includes('dns')) {
    return {
      code: NetErrorCode.NET_DNS_RESOLUTION,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_DNS_RESOLUTION],
      details: rawMessage,
      rawError: error,
    };
  }

  // 4. Ruta inalcanzable
  if (
    rawCode === 'EHOSTUNREACH' ||
    rawCode === 'ENETUNREACH' ||
    combinedText.includes('no route to host') ||
    combinedText.includes('network unreachable')
  ) {
    return {
      code: NetErrorCode.NET_NO_ROUTE,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_NO_ROUTE],
      details: rawMessage,
      rawError: error,
    };
  }

  // 5. Autenticación inválida
  if (
    status === 401 ||
    combinedText.includes('authentication failed') ||
    combinedText.includes('invalid user or password') ||
    combinedText.includes('bad login') ||
    combinedText.includes('unauthorized') ||
    combinedText.includes('login incorrect')
  ) {
    return {
      code: NetErrorCode.NET_AUTH_INVALID,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_AUTH_INVALID],
      details: rawMessage,
      rawError: error,
    };
  }

  // 6. Permisos denegados
  if (
    status === 403 ||
    combinedText.includes('permission denied') ||
    combinedText.includes('not enough permissions') ||
    combinedText.includes('access denied') ||
    combinedText.includes('forbidden')
  ) {
    return {
      code: NetErrorCode.NET_PERMISSION_DENIED,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_PERMISSION_DENIED],
      details: rawMessage,
      rawError: error,
    };
  }

  // 7. Error TLS / SSL
  if (
    rawCode.startsWith('CERT_') ||
    rawCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    rawCode === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    combinedText.includes('tls') ||
    combinedText.includes('certificate') ||
    combinedText.includes('ssl')
  ) {
    return {
      code: NetErrorCode.NET_TLS_ERROR,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_TLS_ERROR],
      details: rawMessage,
      rawError: error,
    };
  }

  // 8. WireGuard handshake stale / VPN caída
  if (combinedText.includes('wireguard') && combinedText.includes('handshake')) {
    return {
      code: NetErrorCode.NET_WG_HANDSHAKE_STALE,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_WG_HANDSHAKE_STALE],
      details: rawMessage,
      rawError: error,
    };
  }
  if (combinedText.includes('vpn') && (combinedText.includes('down') || combinedText.includes('caída'))) {
    return {
      code: NetErrorCode.NET_VPN_DOWN,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_VPN_DOWN],
      details: rawMessage,
      rawError: error,
    };
  }

  // 9. Recurso no encontrado (HTTP 404 / entity missing)
  if (
    status === 404 ||
    combinedText.includes('no such item') ||
    combinedText.includes('not found') ||
    combinedText.includes('no such command')
  ) {
    return {
      code: NetErrorCode.NET_TARGET_NOT_FOUND,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_TARGET_NOT_FOUND],
      details: rawMessage,
      rawError: error,
    };
  }

  // 10. Versión no soportada
  if (combinedText.includes('unsupported version') || combinedText.includes('routeros version')) {
    return {
      code: NetErrorCode.NET_UNSUPPORTED_VERSION,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_UNSUPPORTED_VERSION],
      details: rawMessage,
      rawError: error,
    };
  }

  // 11. Error de comando (RouterOS trap o CLI ZTE)
  if (
    combinedText.includes('!trap') ||
    combinedText.includes('%error') ||
    combinedText.includes('% incomplete command') ||
    combinedText.includes('% unrecognized command') ||
    combinedText.includes('invalid input')
  ) {
    return {
      code: NetErrorCode.NET_COMMAND_ERROR,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_COMMAND_ERROR],
      details: rawMessage,
      rawError: error,
    };
  }

  // 12. Equipo fuera de línea genérico
  if (combinedText.includes('offline') || combinedText.includes('fuera de línea')) {
    return {
      code: NetErrorCode.NET_DEVICE_OFFLINE,
      message: ERROR_MESSAGES_ES[NetErrorCode.NET_DEVICE_OFFLINE],
      details: rawMessage,
      rawError: error,
    };
  }

  return {
    code: NetErrorCode.NET_UNKNOWN,
    message: rawMessage || ERROR_MESSAGES_ES[NetErrorCode.NET_UNKNOWN],
    details: rawMessage,
    rawError: error,
  };
}
