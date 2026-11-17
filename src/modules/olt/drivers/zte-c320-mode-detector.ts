/**
 * zte-c320-mode-detector.ts
 *
 * Motor de detección multivariable del modo de operación de una ONU ZTE GPON.
 * Analiza la salida cruda de "show onu running config <iface>" (bloque pon-onu-mng)
 * y clasifica la configuración como bridge, router, mixed o unknown mediante
 * un scoring de evidencia ponderado — sin valores hardcodeados.
 */

import { OnuModeDetectionResult } from '../ports/onu-mode.types';
export { OnuModeDetectionResult } from '../ports/onu-mode.types';

export function detectOnuMode(rawConfig: string): OnuModeDetectionResult {
  if (!rawConfig || typeof rawConfig !== 'string') {
    return {
      mode: 'unknown',
      ethPortsDetected: [],
      confidence: 'low',
      evidence: ['[UNKNOWN] Salida de configuración vacía o no válida'],
    };
  }

  const lines = rawConfig
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // ── Extracción de evidencias ──────────────────────────────────────────────

  const hasIphost1Bind = lines.some((l) => /^switchport-bind switch_0\/1 iphost 1$/.test(l));
  const hasIphost1Filter = lines.some((l) => /^vlan-filter iphost 1 pri \d+ vlan \d+$/.test(l));
  const hasVlanPortTag = lines.some((l) => /^vlan port eth_0\/\d+ mode tag vlan \d+$/.test(l));

  // Detección de dhcp-ip ethuni
  const dhcpFromOnu = lines.filter((l) => /^dhcp-ip ethuni eth_0\/\d+ from-onu$/.test(l));
  const dhcpFromInternet = lines.filter((l) => /^dhcp-ip ethuni eth_0\/\d+ from-internet$/.test(l));

  // Puertos Ethernet detectados (de dhcp-ip ethuni o vlan port)
  const ethPortNums = new Set<number>();
  for (const l of lines) {
    const m = l.match(/eth_0\/(\d+)/);
    if (m) ethPortNums.add(parseInt(m[1], 10));
  }

  // VLAN de Internet
  let internetVlan: number | undefined;
  // Prioridad 1: filtro de iphost 1
  for (const l of lines) {
    const m = l.match(/^vlan-filter iphost 1 pri \d+ vlan (\d+)$/);
    if (m) {
      internetVlan = parseInt(m[1], 10);
      break;
    }
  }
  // Prioridad 2: vlan port tag
  if (!internetVlan) {
    for (const l of lines) {
      const m = l.match(/^vlan port eth_0\/\d+ mode tag vlan (\d+)$/);
      if (m) {
        internetVlan = parseInt(m[1], 10);
        break;
      }
    }
  }
  // Prioridad 3: flow 1
  if (!internetVlan) {
    for (const l of lines) {
      const m = l.match(/^flow 1 pri \d+ vlan (\d+)$/);
      if (m) {
        internetVlan = parseInt(m[1], 10);
        break;
      }
    }
  }

  // VLAN de Gestión (TR-069)
  let managementVlan: number | undefined;
  for (const l of lines) {
    const m = l.match(/^vlan-filter iphost 2 pri \d+ vlan (\d+)$/);
    if (m) {
      managementVlan = parseInt(m[1], 10);
      break;
    }
  }
  if (!managementVlan) {
    for (const l of lines) {
      const m = l.match(/^flow 2 pri \d+ vlan (\d+)$/);
      if (m) {
        managementVlan = parseInt(m[1], 10);
        break;
      }
    }
  }

  // iphost identificados
  let internetIpHost: number | undefined;
  if (hasIphost1Bind) internetIpHost = 1;
  let managementIpHost: number | undefined;
  if (lines.some((l) => /^switchport-bind switch_0\/1 iphost 2$/.test(l))) managementIpHost = 2;

  // Origen DHCP
  let dhcpSource: OnuModeDetectionResult['dhcpSource'];
  if (dhcpFromOnu.length === 0 && dhcpFromInternet.length === 0) dhcpSource = 'none';
  else if (dhcpFromOnu.length > 0 && dhcpFromInternet.length === 0) dhcpSource = 'from-onu';
  else if (dhcpFromInternet.length > 0 && dhcpFromOnu.length === 0) dhcpSource = 'from-internet';
  else dhcpSource = 'mixed';

  // ── Scoring Ponderado ──────────────────────────────────────────────────────

  let routerScore = 0;
  let bridgeScore = 0;
  const evidence: string[] = [];

  if (hasIphost1Bind) {
    routerScore += 3;
    evidence.push('[ROUTER+3] switchport-bind switch_0/1 iphost 1 presente');
  }
  if (hasIphost1Filter) {
    routerScore += 3;
    evidence.push('[ROUTER+3] vlan-filter iphost 1 presente');
  }
  if (dhcpFromOnu.length > 0) {
    routerScore += 2;
    evidence.push(`[ROUTER+2] dhcp-ip ethuni from-onu en ${dhcpFromOnu.length} puerto(s)`);
  }
  if (!hasVlanPortTag) {
    routerScore += 1;
    evidence.push('[ROUTER+1] ausencia de vlan port eth_0/X mode tag');
  }

  if (hasVlanPortTag) {
    bridgeScore += 3;
    evidence.push('[BRIDGE+3] vlan port eth_0/X mode tag presente');
  }
  if (dhcpFromInternet.length > 0) {
    bridgeScore += 2;
    evidence.push(`[BRIDGE+2] dhcp-ip ethuni from-internet en ${dhcpFromInternet.length} puerto(s)`);
  }
  if (!hasIphost1Bind && !hasIphost1Filter) {
    bridgeScore += 2;
    evidence.push('[BRIDGE+2] ausencia de iphost 1 bind + filter');
  }

  // ── Clasificación ──────────────────────────────────────────────────────────

  let mode: OnuModeDetectionResult['mode'];
  let confidence: OnuModeDetectionResult['confidence'];

  if (routerScore >= 4 && bridgeScore === 0) {
    mode = 'router';
    confidence = 'high';
  } else if (bridgeScore >= 4 && routerScore === 0) {
    mode = 'bridge';
    confidence = 'high';
  } else if (routerScore >= 2 && bridgeScore >= 2) {
    mode = 'mixed';
    confidence = 'low';
    evidence.push(`[MIXED] routerScore=${routerScore}, bridgeScore=${bridgeScore} — configuración inconsistente o residual`);
  } else {
    mode = 'unknown';
    confidence = 'low';
    evidence.push(`[UNKNOWN] scores insuficientes: routerScore=${routerScore}, bridgeScore=${bridgeScore}`);
  }

  return {
    mode,
    internetVlan,
    managementVlan,
    internetIpHost,
    managementIpHost,
    dhcpSource,
    ethPortsDetected: Array.from(ethPortNums).sort((a, b) => a - b),
    confidence,
    evidence,
  };
}
