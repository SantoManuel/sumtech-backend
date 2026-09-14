export interface RouterOsCredentials {
  username: string;
  password: string;
}

/**
 * Las credenciales de la API de RouterOS NUNCA se guardan en Postgres (ver
 * el riesgo "Credenciales de RouterOS" del plan de integración): viven en la
 * variable de entorno ROUTEROS_CREDENTIALS como JSON, indexadas por el
 * nombre EXACTO del NetworkNodeEntity al que pertenecen.
 */
export function resolveRouterOsCredentials(
  nodeName: string,
  env: NodeJS.ProcessEnv = process.env,
): RouterOsCredentials {
  const raw = env.ROUTEROS_CREDENTIALS;
  if (!raw) {
    throw new Error(
      'ROUTEROS_CREDENTIALS no está configurado. Debe ser un JSON de la forma ' +
        '{"<nombre exacto del nodo>": {"username": "...", "password": "..."}}.',
    );
  }

  let parsed: Record<string, Partial<RouterOsCredentials>>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('ROUTEROS_CREDENTIALS no contiene un JSON válido.');
  }

  const credentials = parsed[nodeName];
  if (!credentials || !credentials.username || !credentials.password) {
    throw new Error(`No hay credenciales configuradas para el nodo "${nodeName}" en ROUTEROS_CREDENTIALS.`);
  }

  return { username: credentials.username, password: credentials.password };
}
