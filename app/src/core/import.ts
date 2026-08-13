// Capture-file import: JSONL text (one AEP event per line — the shape the
// reference stack's durable sink writes) fed through the same store reducer
// as the live stream, as an offline source. DOM-free; the file-picker and
// drag-drop UI lives in the fleet view.
import type { AepEvent } from '@agenteventprotocol/sdk';
import { IMPORT_SOURCE, type Store } from './store.js';

export interface ImportResult {
  /** Events newly applied (parsed fine but already known are not counted). */
  applied: number;
  /** Unparsable lines — a torn final line from a killed writer lands here. */
  skipped: number;
  /** Distinct sessions the applied events touched. */
  sessions: string[];
}

/**
 * Parse one JSONL capture and feed it to the store as imported history.
 * Blank lines are ignored; any line that does not parse to an object is
 * counted in `skipped` (never a throw — a capture's final line may be torn).
 */
export function importCapture(store: Store, text: string): ImportResult {
  const result: ImportResult = { applied: 0, skipped: 0, sessions: [] };
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      result.skipped++;
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      result.skipped++;
      continue;
    }
    const ev = parsed as AepEvent;
    if (store.apply(ev, { source: IMPORT_SOURCE })) {
      result.applied++;
      if (typeof ev.session === 'string' && !seen.has(ev.session)) {
        seen.add(ev.session);
        result.sessions.push(ev.session);
      }
    }
  }
  return result;
}
