// Control surface for one lane, two provenance-labeled halves: DECLARED —
// the relay roster's live claims (AEP-0003 §4.1), a snapshot of what the
// claiming connection declared it accepts, verbatim, with visible ambiguity
// when two claimants share the session name and an honest "no live claim"
// when the roster stopped listing it — and OBSERVED, what each control verb
// sent from THIS observer actually settled to. Neither half ever gates the
// send path: a declaration is a snapshot, never a promise (the target's
// accepts at command time stays authoritative), untried verbs stay untried,
// and a refusal names the nack reason.
import { SlidersHorizontal } from 'lucide-react';
import type { ControlSettle, Lane } from '@/core/store';
import { steerVerb } from '@/core/steer-verbs';
import { formatClock } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const CORE_VERBS = [
  'control.attention.respond',
  'control.cancel',
  'control.pause',
  'control.resume',
];

function SettleChip({ settle }: { settle: ControlSettle | undefined }) {
  if (!settle) {
    return (
      <Badge variant="outline" className="text-faint">
        untried
      </Badge>
    );
  }
  if (settle.state === 'accepted') {
    return <Badge className="bg-severity-info/15 text-severity-info">accepted</Badge>;
  }
  return (
    <Badge className="bg-severity-warning/15 text-severity-warning">
      refused · {settle.reason ?? 'unknown'}
    </Badge>
  );
}

export function ControlPanel({ lane }: { lane: Lane }) {
  const verbs = [...CORE_VERBS];
  if (lane.agent) {
    const steer = steerVerb(lane.agent).type;
    if (!verbs.includes(steer)) verbs.push(steer);
  }
  for (const type of lane.control.keys()) {
    if (!verbs.includes(type)) verbs.push(type);
  }
  const kinds = [...lane.kindsSeen].sort();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b p-3 text-xs text-muted-foreground">
        <SlidersHorizontal className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p>
          Declared is the relay roster&apos;s snapshot of the live claim&apos;s own capability
          declaration; observed is what control sends from this observer actually settled to.
          Neither gates sending (send-and-settle; a refusal is the designed answer, not a
          failure).
        </p>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {lane.declared !== undefined && (
          <div className="border-b p-3" data-testid="declared-block">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Declared by the live claim{lane.declared.length > 1 ? 's' : ''} (roster snapshot
              {lane.declaredAt ? ` · ${formatClock(new Date(lane.declaredAt).toISOString())}` : ''})
            </p>
            {lane.declared.length === 0 && (
              <p className="text-xs text-faint">
                No live claim on the relay right now — commands would be refused no-route.
              </p>
            )}
            {lane.declared.length > 1 && (
              <p className="mb-2 text-xs text-severity-warning">
                {lane.declared.length} live connections claim this session name — commands to it
                are refused as ambiguous until one remains.
              </p>
            )}
            {lane.declared.map((claim, i) => (
              <div key={i} className="mb-1 flex flex-wrap items-center gap-1.5 last:mb-0">
                {(claim.agent || claim.instance) && (
                  <span className="font-mono text-xs text-faint">
                    {claim.agent ?? '?'}{claim.instance ? `@${claim.instance}` : ''}
                  </span>
                )}
                {claim.accepts.length === 0 && (
                  <Badge variant="outline" className="text-faint">accepts nothing</Badge>
                )}
                {claim.accepts.map((t) => (
                  <Badge key={t} variant="outline" className="font-mono text-xs">
                    {t}
                  </Badge>
                ))}
              </div>
            ))}
          </div>
        )}
        <ul className="divide-y">
          {verbs.map((verb) => {
            const settle = lane.control.get(verb);
            return (
              <li key={verb} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="font-mono text-xs">{verb}</span>
                <span className="ml-auto flex items-center gap-2">
                  {settle?.detail && (
                    <span
                      className={cn('max-w-64 truncate text-xs text-faint')}
                      title={settle.detail}
                    >
                      {settle.detail}
                    </span>
                  )}
                  {settle && (
                    <span className="font-mono text-xs text-faint tabular-nums">
                      {formatClock(new Date(settle.at).toISOString())}
                    </span>
                  )}
                  <SettleChip settle={settle} />
                </span>
              </li>
            );
          })}
        </ul>
        {kinds.length > 0 && (
          <div className="border-t p-3">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Event kind families seen on this lane
            </p>
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((k) => (
                <Badge key={k} variant="outline" className="font-mono text-xs">
                  {k}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
