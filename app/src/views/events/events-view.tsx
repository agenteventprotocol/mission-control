// Global live tail: every event across all sessions in arrival order,
// virtualized, with text/severity filters. Clicking a row jumps into the
// owning session's detail view.
import { useMemo, useRef, useState, useEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { RadioTower, Search } from 'lucide-react';
import type { AepEvent, Severity } from '@agenteventprotocol/sdk';
import { familyOf, lastSegment, severityRank, shortSessionId, SEVERITIES } from '@/lib/aep';
import { formatClock, formatCount } from '@/lib/format';
import { summarize } from '@/lib/summary';
import { useController, useStoreVersion } from '@/state/use-store';
import { relayDisplay } from '@/lib/relays';
import { navigate } from '@/state/router';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeverityDot } from '@/components/event/severity-dot';
import { EmptyState } from '@/components/layout/empty-state';
import { ViewHeader } from '@/components/layout/view-header';

export function EventsView() {
  const controller = useController();
  const store = controller.store;
  const relays = controller.config.relays;
  const relayChipFor = (ev: AepEvent): string => {
    const key = store.laneKeyOf(ev);
    const lane = key ? store.sessions.get(key) : undefined;
    return lane ? relayDisplay(lane.source, relays) : '';
  };
  useStoreVersion(store);

  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<Severity>('debug');

  const lensRank = severityRank(lens);
  const rows = useMemo(() => {
    let out: AepEvent[] = store.recent;
    if (lensRank > 0) out = out.filter((ev) => severityRank(ev.severity) >= lensRank);
    if (query) {
      const q = query.toLowerCase();
      out = out.filter((ev) =>
        `${ev.type} ${ev.agent} ${ev.session ?? ''} ${summarize(ev)}`.toLowerCase().includes(q),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recent mutates; version tracks it
  }, [store, store.version, query, lensRank]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 16,
  });

  const following = useRef(true);
  useEffect(() => {
    if (following.current && rows.length > 0) {
      virtualizer.scrollToIndex(rows.length - 1, { align: 'end' });
    }
  }, [rows.length, virtualizer]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <ViewHeader
        icon={RadioTower}
        title="Live tail"
        meta={`${formatCount(store.totalEvents)} events observed`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-72">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint" aria-hidden />
          <Input
            className="pl-8"
            placeholder="Filter the tail…"
            aria-label="Filter events"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={lens} onValueChange={(v) => setLens(v as Severity)}>
          <SelectTrigger aria-label="Severity lens">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITIES.map((sev) => (
              <SelectItem key={sev} value={sev}>
                <span className="inline-flex items-center gap-1.5">
                  <SeverityDot severity={sev} />
                  {sev === 'debug' ? 'lens off' : `${sev}+`}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-faint tabular-nums">
          {formatCount(rows.length)} shown
          {store.recentDropped > 0 && ` · ${formatCount(store.recentDropped)} rotated out`}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={RadioTower} title="Nothing on the wire yet">
          <p>Every event this observer receives shows up here in arrival order.</p>
        </EmptyState>
      ) : (
        <div ref={parentRef} className="min-h-0 flex-1 overflow-auto rounded-lg border bg-card"
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 40;
          }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const ev = rows[vi.index] as AepEvent;
              const family = familyOf(ev.type);
              return (
                <button
                  key={`${ev.id}-${vi.index}`}
                  type="button"
                  onClick={() => {
                    const key = store.laneKeyOf(ev) ?? (typeof ev.session === 'string' ? ev.session : null);
                    if (key) navigate({ view: 'session', session: key });
                  }}
                  className="absolute top-0 left-0 flex w-full cursor-pointer items-center gap-2.5 border-b border-grid px-2 text-left text-xs hover:bg-accent/60"
                  style={{ height: vi.size, transform: `translateY(${vi.start}px)` }}
                >
                  <span className="w-24 shrink-0 font-mono text-faint tabular-nums">
                    {formatClock(String(ev.time))}
                  </span>
                  <SeverityDot severity={ev.severity} />
                  <span className="w-24 shrink-0 truncate font-mono text-faint">
                    #{typeof ev.session === 'string' ? shortSessionId(ev.session) : '—'}
                  </span>
                  <span className="w-28 shrink-0 truncate text-muted-foreground">{ev.agent}</span>
                  {relays.length > 1 && (
                    <span className="w-24 shrink-0 truncate text-faint">
                      {relayChipFor(ev)}
                    </span>
                  )}
                  <span className="w-44 shrink-0 truncate font-mono text-foreground/90">
                    <span className="text-faint">{family !== 'unknown' ? `${family}.` : ''}</span>
                    {lastSegment(ev.type)}
                  </span>
                  <span className="truncate text-muted-foreground">{summarize(ev)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
