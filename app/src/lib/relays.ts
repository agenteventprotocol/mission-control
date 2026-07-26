// Presentation helpers for lane sources. Pure: testable without the DOM.
import type { LaneSource } from '../core/store.js';
import type { RelayEntry } from '../state/config.js';

/**
 * Human name for a lane's source: the configured label when one exists,
 * else the URL with its scheme stripped (`127.0.0.1:8790`), else
 * `imported`. The chip only renders past one configured relay
 * (progressive disclosure), so single-relay chrome carries no new text.
 */
export function relayDisplay(source: LaneSource, relays: RelayEntry[]): string {
  if (source.kind === 'import') return 'imported';
  const entry = relays.find((r) => r.url.trim().replace(/\/$/, '') === source.relay);
  if (entry?.label) return entry.label;
  return source.relay.replace(/^[a-z]+:\/\//, '') || 'local';
}

/** Chips/dots/filter appear only when more than one relay is configured. */
export function multiRelay(relays: RelayEntry[]): boolean {
  return relays.length > 1;
}
