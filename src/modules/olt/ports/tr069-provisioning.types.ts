export type Tr069Outcome = 'failed' | 'partial' | 'applied_unverified' | 'verified';
export type EvidenceStatus = 'confirmed' | 'failed' | 'unknown' | 'not_supported';
export interface Tr069Evidence { status: EvidenceStatus; at: string; source: string; reason?: string }
export interface Tr069Issue { code: string; stage: string; message: string }
export interface Tr069Result {
  ok: boolean;
  status: Tr069Outcome;
  operationId?: string;
  stage: string;
  configurationStatus: EvidenceStatus;
  persistenceStatus: EvidenceStatus;
  evidence: Record<'configuration' | 'persistence' | 'omci' | 'ip' | 'acs' | 'network', Tr069Evidence>;
  issues: Tr069Issue[];
  attempts: number;
  rebootCount: 0;
  durationMs: number;
  queueWaitMs?: number;
  error?: string;
  warning?: string;
}
export function evidence(status: EvidenceStatus, source: string, reason?: string): Tr069Evidence {
  return { status, source, reason, at: new Date().toISOString() };
}
export function initialTr069Result(): Tr069Result {
  return {
    ok: false, status: 'failed', stage: 'preflight', configurationStatus: 'unknown', persistenceStatus: 'unknown',
    evidence: Object.fromEntries(['configuration', 'persistence', 'omci', 'ip', 'acs', 'network']
      .map(key => [key, evidence('unknown', key)])) as Tr069Result['evidence'],
    issues: [], attempts: 0, rebootCount: 0, durationMs: 0,
  };
}
