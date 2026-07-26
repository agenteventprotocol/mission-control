// Session state: the value reconstructed from state.snapshot + ordered
// state.delta patches (store.stateOf). Capture honesty is the whole design:
// a gated snapshot registers without a value, gated patches show as op
// counts, and nothing is ever fabricated below the ceiling.
import { Boxes } from 'lucide-react';
import type { LaneState } from '@/core/store';
import { formatClock } from '@/lib/format';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { JsonTree } from '@/components/event/json-tree';
import { EmptyState } from '@/components/layout/empty-state';

export function StatePanel({ state }: { state: LaneState }) {
  if (!state.hasSnapshot && state.appliedOps === 0 && state.gatedOps === 0) {
    return (
      <EmptyState icon={Boxes} title="No session state">
        <p>
          This session has emitted no <span className="font-mono">state.snapshot</span> or{' '}
          <span className="font-mono">state.delta</span> events. Agents that speak a state-bearing
          surface (AG-UI, for one) populate this panel.
        </p>
      </EmptyState>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3 text-xs">
        <Badge variant="outline">{state.appliedOps} ops applied</Badge>
        {state.gatedOps > 0 && (
          <Badge
            variant="default"
            title="Patch bodies withheld by the capture ceiling — counted, never reconstructed."
          >
            {state.gatedOps} ops gated at capture
          </Badge>
        )}
        {state.skippedOps > 0 && (
          <Badge variant="outline" title="Operations that did not apply against the current value.">
            {state.skippedOps} skipped
          </Badge>
        )}
        {state.lastAt && (
          <span className="ml-auto font-mono text-faint tabular-nums">
            {formatClock(state.lastAt)}
          </span>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          {state.value !== undefined ? (
            <JsonTree value={state.value} />
          ) : (
            <p className="text-sm text-faint">
              {state.hasSnapshot
                ? 'The snapshot payload was capture-gated — the state exists upstream, but this observer may not see it.'
                : 'No snapshot yet — patches without a base cannot be applied honestly.'}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
