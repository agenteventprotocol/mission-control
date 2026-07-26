// Inline quick-answer strip on a fleet card: the session's oldest pending
// request, answerable without leaving the fleet. Options answer in one tap;
// forms hand off to the dock (the full renderer lives there); prompt-only
// requests get an inline reply box. Same wire rules as everywhere: items
// settle only off the stream, nacks revert with the error shown.
// respond_via (AEP-0008): a request that declares its channel without
// "control" renders as information — same rule as the full card.
import { useState } from 'react';
import { BellRing, CornerDownLeft, LoaderCircle, PanelRightOpen } from 'lucide-react';
import type { AttentionItem, Lane } from '@/core/store';
import { useController } from '@/state/use-store';
import { useUi } from '@/state/ui';
import { readFields, readOptions } from '@/views/inbox/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function oldestPending(lane: Lane): { item: AttentionItem; more: number } | null {
  let items: AttentionItem[] = [];
  for (const item of lane.attention.values()) {
    if (item.state === 'pending' || item.state === 'responding') items.push(item);
  }
  if (items.length === 0) return null;
  items = items.sort((a, b) => String(a.request.time).localeCompare(String(b.request.time)));
  return { item: items[0]!, more: items.length - 1 };
}

export function QuickAnswer({ lane }: { lane: Lane }) {
  const controller = useController();
  const { openDock } = useUi();
  const [text, setText] = useState('');
  const respond = (item: AttentionItem, answer: Parameters<typeof controller.respond>[1]) =>
    controller.respond(item, answer);

  if (lane.source.kind === 'import') return null; // no live backchannel — nothing to answer
  const pending = oldestPending(lane);
  if (!pending) return null;
  const { item, more } = pending;

  const req = item.request;
  const data = (req.data ?? {}) as Record<string, unknown>;
  const isForm = readFields(data).length > 0;
  const options = isForm ? [] : readOptions(data);
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const kind = typeof data.kind === 'string' ? data.kind : 'attention';
  const responding = item.state === 'responding';
  const respondVia = Array.isArray(data.respond_via)
    ? (data.respond_via as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;
  const controlDeliverable = respondVia === null || respondVia.includes('control');

  return (
    <div className="border-t border-family-attention/25 bg-family-attention/6 px-3 py-2">
      <div className="flex items-start gap-2">
        <BellRing className="mt-0.5 size-3.5 shrink-0 text-family-attention" aria-hidden />
        <p className="line-clamp-2 min-w-0 flex-1 text-xs">{prompt || kind}</p>
        {more > 0 && (
          <button
            type="button"
            className="shrink-0 cursor-pointer text-xs whitespace-nowrap text-faint hover:text-foreground"
            onClick={openDock}
          >
            +{more} more
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-5.5">
        {!controlDeliverable ? (
          <span className="text-xs text-muted-foreground">
            answered in the agent's own UI ({respondVia && respondVia.length ? respondVia.join(', ') : 'no channel'})
          </span>
        ) : responding ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" aria-hidden />
            responding…
          </span>
        ) : isForm ? (
          <Button size="sm" onClick={openDock}>
            Answer form
            <PanelRightOpen aria-hidden />
          </Button>
        ) : options.length > 0 ? (
          options.slice(0, 3).map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              variant={opt.id === 'deny' || opt.id === 'reject' ? 'outline' : 'default'}
              onClick={() => respond(item, { option: opt.id })}
            >
              {opt.label}
            </Button>
          ))
        ) : (
          <form
            className="flex min-w-40 flex-1 items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = text.trim();
              if (trimmed) respond(item, { text: trimmed });
            }}
          >
            <Input
              className="h-7 text-xs"
              placeholder="reply…"
              aria-label="quick reply"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" aria-label="Send reply">
              <CornerDownLeft />
            </Button>
          </form>
        )}
        {item.error && (
          <span role="alert" className="text-xs text-severity-critical">
            {item.error}
          </span>
        )}
      </div>
    </div>
  );
}
