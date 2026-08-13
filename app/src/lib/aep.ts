// Presentation-side vocabulary helpers. These never re-derive protocol
// semantics (that is the store's job) — they only map already-derived values
// to display groupings.
import type { Severity } from '@agenteventprotocol/sdk';

/** Type families with a dedicated color token; anything else renders muted. */
export const FAMILIES = ['session', 'run', 'tool', 'attention', 'control'] as const;
export type Family = (typeof FAMILIES)[number] | 'unknown';

const KNOWN_FAMILIES: ReadonlySet<string> = new Set(FAMILIES);

export function familyOf(type: string): Family {
  const fam = type.split('.')[0] ?? '';
  return KNOWN_FAMILIES.has(fam) ? (fam as Family) : 'unknown';
}

export function lastSegment(type: string): string {
  const parts = type.split('.');
  return parts[parts.length - 1] || type;
}

export function shortSessionId(session: string): string {
  return session.length > 8 ? session.slice(-8) : session;
}

/** Severity scale, lowest first (AEP-0001 envelope `severity`). */
export const SEVERITIES: readonly Severity[] = [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
];

const SEVERITY_RANK = new Map<string, number>(SEVERITIES.map((s, i) => [s, i]));

/** Rank for lens comparisons; absent/unknown severities rank as `info`. */
export function severityRank(severity: string | undefined): number {
  return SEVERITY_RANK.get(severity ?? 'info') ?? 1;
}
