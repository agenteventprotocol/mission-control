// One actionable attention request. State machine mirrors the wire:
// pending → responding (optimistic, on send) → settled only by
// attention.answered / attention.resolved arriving ON THE STREAM — the ack
// alone never settles an item. Nack / ack-window timeout reverts to pending
// with the error surfaced; the request is still pending on the emitter and
// can be re-answered. Drafts live in React state, so re-renders keep them.
// respond_via (AEP-0008): when the request itself declares its channel and
// control is NOT among them, the card renders as INFORMATION — the options
// are the menu the agent is showing its own operator, and no send affordance
// is offered (a command could only earn a nack). This gates on the request's
// OWN field, never on observed capability settles — request fields cannot go
// stale; observations can (those stay advisory-only below).
import { memo, useState } from 'react';
import { CornerDownLeft, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { AttentionItem } from '@/core/store';
import { shortSessionId } from '@/lib/aep';
import { formatAge } from '@/lib/format';
import { navigate } from '@/state/router';
import { useOptionalController } from '@/state/use-store';
import { relayDisplay } from '@/lib/relays';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityDot } from '@/components/event/severity-dot';
import { cn } from '@/lib/utils';
import { readFields, readOptions, draftValues, type FieldDraft, type FieldSpec } from './fields';

export interface RespondFn {
  (item: AttentionItem, answer: { option?: string; text?: string; values?: Record<string, unknown> }): void;
}

function FormField({
  field,
  draft,
  disabled,
  onChange,
}: {
  field: FieldSpec;
  draft: FieldDraft[string];
  disabled: boolean;
  onChange: (next: FieldDraft[string]) => void;
}) {
  const label = (
    <span className="text-xs font-medium text-muted-foreground">
      {field.label}
      {field.required && <span className="text-family-attention"> *</span>}
    </span>
  );

  if (field.type === 'string' || field.type === 'number') {
    return (
      <label className="block space-y-1">
        {label}
        <Input
          type={field.type === 'number' ? 'number' : 'text'}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          value={draft.value ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
        />
      </label>
    );
  }
  if (field.type === 'boolean') {
    return (
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={draft.checked ?? false}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...draft, checked: checked === true })}
        />
        {label}
      </label>
    );
  }
  if (field.multi) {
    const picks = draft.picks ?? [];
    return (
      <div className="space-y-1">
        {label}
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {field.choices.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <Checkbox
                checked={picks.includes(c.id)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...draft,
                    picks: checked === true ? [...picks, c.id] : picks.filter((p) => p !== c.id),
                  })
                }
              />
              {c.label}
            </label>
          ))}
        </div>
        {field.other && (
          <Input
            placeholder="other…"
            aria-label={`${field.label}: other (free text)`}
            value={draft.other ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, other: e.target.value })}
          />
        )}
      </div>
    );
  }
  // single select: unanswered while nothing is picked (the placeholder state)
  const NONE = '␀none';
  return (
    <div className="space-y-1">
      {label}
      <Select
        value={draft.value ? draft.value : undefined}
        disabled={disabled}
        onValueChange={(value) => onChange({ ...draft, value: value === NONE ? '' : value })}
      >
        <SelectTrigger className="w-full" aria-label={field.label}>
          <SelectValue placeholder="choose…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE} className="text-faint">
            (no answer)
          </SelectItem>
          {field.choices.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {field.other && (
        <Input
          placeholder="other…"
          aria-label={`${field.label}: other (free text)`}
          value={draft.other ?? ''}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, other: e.target.value })}
        />
      )}
    </div>
  );
}

export const AttentionCard = memo(function AttentionCard({
  item,
  now,
  respond,
  compact = false,
}: {
  item: AttentionItem;
  now: number;
  respond: RespondFn;
  /** Dock density: tighter paddings, clamped prompt. */
  compact?: boolean;
}) {
  const controller = useOptionalController();
  const relays = controller?.config.relays ?? [];
  const lane = controller?.store.sessions.get(item.laneKey);
  // Observed-refusal advisory (advisory ONLY — the send path never goes away:
  // the observation can be stale, and the honest settle is send-and-nack).
  // `unsupported` is the one reason that speaks to capability; an `invalid`
  // nack means the verb IS accepted and the answer shape was wrong.
  const respondSettle = lane?.control.get('control.attention.respond');
  const respondRefused =
    respondSettle?.state === 'refused' && respondSettle.reason === 'unsupported';
  const req = item.request;
  const data = (req.data ?? {}) as Record<string, unknown>;
  const fields = readFields(data);
  const options = fields.length === 0 ? readOptions(data) : [];
  const prompt = typeof data.prompt === 'string' ? data.prompt : '';
  const kind = typeof data.kind === 'string' ? data.kind : '';
  const responding = item.state === 'responding';
  // AEP-0008: a well-formed respond_via without "control" marks the request
  // informational on the bus. Malformed values degrade to absent (send path).
  const respondVia = Array.isArray(data.respond_via)
    ? (data.respond_via as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;
  const controlDeliverable = respondVia === null || respondVia.includes('control');

  const [text, setText] = useState('');
  const [draft, setDraft] = useState<FieldDraft>({});

  const sendText = () => {
    const trimmed = text.trim();
    if (trimmed) respond(item, { text: trimmed });
  };

  // An option and free text are answerable together (the answer shape carries
  // both): the typed reply rides the tapped choice as its rationale rather
  // than being dropped. Targets that render it map it onto their own feedback
  // field; the option alone is unchanged when nothing was typed.
  const sendOption = (option: string) => {
    const trimmed = text.trim();
    respond(item, trimmed ? { option, text: trimmed } : { option });
  };

  return (
    <article
      className={cn(
        'mc-attention-card rounded-lg border border-family-attention/35 bg-card',
        compact ? 'p-3' : 'p-4',
      )}
      data-request-id={req.id}
      data-state={item.state}
    >
      <header className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{req.agent}</span>
        <button
          type="button"
          className="cursor-pointer font-mono text-xs text-faint hover:text-foreground"
          title={`Open session ${item.session}`}
          onClick={() => navigate({ view: 'session', session: item.laneKey })}
        >
          #{shortSessionId(item.session)}
        </button>
        {kind && <Badge>{kind}</Badge>}
        {relays.length > 1 && lane?.source.kind === 'relay' && (
          <Badge variant="outline">{relayDisplay(lane.source, relays)}</Badge>
        )}
        {req.severity && <SeverityDot severity={req.severity} showLabel={!compact} />}
        <span className="ml-auto text-xs text-faint" title={String(req.time)}>
          {formatAge(now - Date.parse(String(req.time)))}
        </span>
      </header>

      {prompt && <p className={cn('mt-2 text-sm', compact && 'line-clamp-3')}>{prompt}</p>}

      {responding && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          responding — waiting for the stream to confirm…
        </p>
      )}
      {item.error && (
        <p
          role="alert"
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-severity-critical/40 bg-severity-critical/10 px-2 py-1 text-xs text-severity-critical"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {item.error}
        </p>
      )}
      {!item.error && controlDeliverable && respondRefused && (
        <p className="mt-2 inline-flex items-start gap-1.5 rounded-md border border-severity-warning/40 bg-severity-warning/10 px-2 py-1 text-xs text-severity-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This target refused control.attention.respond earlier this session (unsupported) — a
          reply will be nacked again unless the target's gate changed; answer in the agent's own
          UI.
        </p>
      )}

      {!controlDeliverable && (
        <div className="mt-3 space-y-2">
          {options.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {options.map((opt) => (
                <Badge key={opt.id} variant="outline">
                  {opt.label}
                </Badge>
              ))}
            </div>
          )}
          {/* form FIELDS stay visible read-only: on an oob card the operator
              still needs to SEE what the agent is asking its own user —
              hiding the question's choices was the options-era gap all over
              again (AEP-0008's consumer rule, applied to AEP-0006 fields) */}
          {fields.length > 0 && (
            <div className="space-y-2">
              {fields.map((f) => (
                <div key={f.id} className="space-y-1">
                  <p className="text-xs font-medium">{f.label}</p>
                  {f.type === 'select' && f.choices.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.choices.map((c) => (
                        <Badge key={c.id} variant="outline">
                          {c.label}
                        </Badge>
                      ))}
                      {f.other && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Other…
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">free-form answer</p>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Answered in the agent's own UI — this request declares its response channel
            ({respondVia && respondVia.length ? respondVia.join(', ') : 'none'}) and cannot be
            answered from here.
          </p>
        </div>
      )}

      {controlDeliverable && fields.length > 0 && (
        <form
          className="mt-3 space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            respond(item, { values: draftValues(fields, draft) });
          }}
        >
          {fields.map((f) => (
            <FormField
              key={f.id}
              field={f}
              draft={draft[f.id] ?? {}}
              disabled={responding}
              onChange={(next) => setDraft({ ...draft, [f.id]: next })}
            />
          ))}
          <Button type="submit" disabled={responding}>
            Submit
          </Button>
        </form>
      )}

      {controlDeliverable && fields.length === 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {options.map((opt) => (
            <Button
              key={opt.id}
              variant={opt.id === 'deny' || opt.id === 'reject' ? 'outline' : 'default'}
              disabled={responding}
              onClick={() => sendOption(opt.id)}
            >
              {opt.label}
            </Button>
          ))}
          <form
            className="flex min-w-40 flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendText();
            }}
          >
            <Input
              placeholder="reply…"
              aria-label="free-text response"
              value={text}
              disabled={responding}
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" variant="outline" disabled={responding} aria-label="Send reply">
              <CornerDownLeft />
            </Button>
          </form>
        </div>
      )}
    </article>
  );
});
