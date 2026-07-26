// The attention center: everything still actionable across all sessions
// (oldest first), then the recent decision history — how each request
// settled, whoever settled it. Items settle only from the stream, so a
// request answered elsewhere (another consumer, another tab) converges here
// by construction.
import { useEffect, useState } from 'react';
import { BellRing, CheckCheck, History, Inbox } from 'lucide-react';
import type { AttentionItem } from '@/core/store';
import { shortSessionId } from '@/lib/aep';
import { formatAge } from '@/lib/format';
import { navigate } from '@/state/router';
import { useController, useStoreVersion } from '@/state/use-store';
import { EmptyState } from '@/components/layout/empty-state';
import { ViewHeader } from '@/components/layout/view-header';
import { cn } from '@/lib/utils';
import { AttentionCard } from './attention-card';

const AGE_TICK_MS = 1000;

// Settled cleanly is the norm — monochrome; only a timeout carries heat.
const OUTCOME: Record<string, { label: string; cls: string }> = {
  answered: { label: 'answered', cls: 'bg-muted text-muted-foreground' },
  resolved: { label: 'resolved', cls: 'bg-muted text-muted-foreground' },
  timeout: { label: 'timed out', cls: 'bg-severity-warning/15 text-severity-warning' },
};

function answerSummary(item: AttentionItem): string {
  const answer = item.answer as Record<string, unknown> | undefined;
  if (!answer) return '';
  if (typeof answer.option === 'string') return answer.option;
  if (typeof answer.text === 'string') return `"${answer.text}"`;
  if (answer.values && typeof answer.values === 'object') {
    return `${Object.keys(answer.values).length} field(s)`;
  }
  return '';
}

function DecisionRow({ item, now }: { item: AttentionItem; now: number }) {
  const req = item.request;
  const data = (req.data ?? {}) as Record<string, unknown>;
  const prompt = typeof data.prompt === 'string' ? data.prompt : (typeof data.kind === 'string' ? data.kind : '');
  const outcome = OUTCOME[item.state] ?? OUTCOME.resolved!;
  const summary = answerSummary(item);
  return (
    <li className="flex items-center gap-2.5 border-b border-grid px-3 py-2 text-sm last:border-b-0">
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', outcome.cls)}>
        {outcome.label}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">{req.agent}</span>
      <button
        type="button"
        className="shrink-0 cursor-pointer font-mono text-xs text-faint hover:text-foreground"
        title={`Open session ${item.session}`}
        onClick={() => navigate({ view: 'session', session: item.laneKey })}
      >
        #{shortSessionId(item.session)}
      </button>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{prompt}</span>
      {summary && <span className="shrink-0 text-xs font-medium">{summary}</span>}
      <span className="shrink-0 text-xs text-faint" title={String(req.time)}>
        {formatAge(now - Date.parse(String(req.time)))}
      </span>
    </li>
  );
}

export function InboxView() {
  const controller = useController();
  const store = controller.store;
  useStoreVersion(store);

  // One shared ticker for all age labels.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(t);
  }, []);

  const items = store.pendingAttention();
  const settled = store.settledAttention(30);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <ViewHeader
        icon={BellRing}
        title="Attention"
        meta={items.length ? `${items.length} pending` : 'nothing pending'}
      />

      {items.length === 0 ? (
        <EmptyState icon={Inbox} title="Inbox zero">
          <p>No agent is waiting on you. Attention requests appear here the moment they arrive.</p>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <AttentionCard
              key={item.request.id}
              item={item}
              now={now}
              respond={(i, answer) => controller.respond(i, answer)}
            />
          ))}
        </div>
      )}

      {settled.length > 0 && (
        <section className="space-y-2 pt-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <History className="size-4" aria-hidden />
            Recent decisions
          </h2>
          <ul className="rounded-xl border bg-card">
            {settled.map((item) => (
              <DecisionRow key={item.request.id} item={item} now={now} />
            ))}
          </ul>
        </section>
      )}

      {items.length === 0 && settled.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-faint">
          <CheckCheck className="size-3.5" aria-hidden />
          All caught up — the history above shows how recent requests settled.
        </p>
      )}
    </div>
  );
}
