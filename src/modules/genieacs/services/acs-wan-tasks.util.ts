import { isWanParameter } from './cpe-wan-policy.service';

/** Unknown tasks remain blocking. Only known reads and independent writes are exempt. */
export function affectsWanProvisioning(task: unknown): boolean {
  if (!task || typeof task !== 'object') return true;
  const t = task as Record<string, unknown>;
  if (t.name === 'getParameterValues' || t.name === 'refreshObject') return false;
  const affectsPath = (path: string) => isWanParameter(path) || /^(Device|InternetGatewayDevice)\.ManagementServer\./i.test(path);
  if (t.name === 'setParameterValues') {
    if (!Array.isArray(t.parameterValues) || !t.parameterValues.length) return true;
    return t.parameterValues.some(value => !Array.isArray(value) || typeof value[0] !== 'string' || affectsPath(value[0]));
  }
  if (t.name === 'addObject' || t.name === 'deleteObject') {
    return typeof t.objectName !== 'string' || !t.objectName || affectsPath(t.objectName);
  }
  // Reboots, factory resets, firmware downloads and unsupported task formats can interrupt the WAN.
  return true;
}

/** Safe diagnostics: parameter values and passwords must never enter a 409 response. */
export function summarizeAcsTasks(tasks: unknown[]) {
  return tasks.map(task => {
    const t = task && typeof task === 'object' ? task as Record<string, unknown> : {};
    return {
      id: typeof t._id === 'string' ? t._id.slice(0, 100) : null,
      name: typeof t.name === 'string' ? t.name.slice(0, 64) : 'unknown',
    };
  });
}
