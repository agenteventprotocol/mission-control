// One-line, capture-tolerant summaries for timeline / tail rows. Purely
// cosmetic: unknown shapes fall back to nothing rather than guessing.
import type { AepEvent } from '@aep/sdk';

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

export function summarize(ev: AepEvent): string {
  const data = (ev.data ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case 'session.started': {
      const client = data.client as Record<string, unknown> | undefined;
      return str(data.label) ?? str(client?.name) ?? '';
    }
    case 'session.ended':
      return str(data.reason) ?? '';
    case 'run.started':
      return str(data.prompt) ?? str(data.trigger) ?? '';
    case 'run.finished':
    case 'run.failed':
    case 'run.cancelled':
      return str(data.reason) ?? (typeof data.duration_ms === 'number' ? `${data.duration_ms}ms` : '');
    case 'tool.requested':
    case 'tool.completed':
    case 'tool.failed': {
      const tool = data.tool as Record<string, unknown> | undefined;
      const name = str(tool?.name) ?? '';
      const dur = typeof data.duration_ms === 'number' ? ` · ${data.duration_ms}ms` : '';
      return name ? `${name}${dur}` : '';
    }
    case 'attention.requested':
      return str(data.prompt) ?? str(data.kind) ?? '';
    case 'attention.answered': {
      const answer = data.answer as Record<string, unknown> | undefined;
      return str(answer?.option) ?? str(answer?.text) ?? '';
    }
    case 'attention.resolved':
      return str(data.resolution) ?? '';
    default:
      return str(data.prompt) ?? str(data.text) ?? str(data.reason) ?? '';
  }
}
