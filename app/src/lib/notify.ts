// Desktop-notification policy for pending attention, as a pure decision —
// no Notification global here, so the matrix unit-tests anywhere. The thin
// DOM wiring lives in App (AttentionPresence): it supplies the context and
// fires at most one notification per request id.
import type { AttentionItem } from '@/core/store';

export type NotifyPermission = 'default' | 'granted' | 'denied';

export interface NotifyContext {
  /** The operator's explicit opt-in toggle (default OFF). */
  enabled: boolean;
  /** Browser permission; requested only from the toggle click. */
  permission: NotifyPermission;
  /** document.hidden — a visible tab already shows the dock. */
  hidden: boolean;
}

export function shouldNotify(
  item: AttentionItem,
  ctx: NotifyContext,
  alreadyNotified: ReadonlySet<string>,
): boolean {
  if (!ctx.enabled || ctx.permission !== 'granted' || !ctx.hidden) return false;
  if (item.state !== 'pending') return false;
  return !alreadyNotified.has(item.request.id);
}

/** Title = who is asking; body = the first prompt line (or the kind). */
export function notificationContent(item: AttentionItem): { title: string; body: string } {
  const req = item.request;
  const data = (req.data ?? {}) as Record<string, unknown>;
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const kind = typeof data.kind === 'string' ? data.kind : 'attention';
  return {
    title: `${req.agent ?? item.session} needs you`,
    body: prompt.split('\n', 1)[0] || kind,
  };
}
