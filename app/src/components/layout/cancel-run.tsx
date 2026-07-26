// Run-scoped cancel affordance (AEP-0004 §5): a destructive action, so it
// always confirms first. Cancelling is optimistic and settles ONLY off the
// stream — the button reflects the run's `cancelling` marker and surfaces a
// nack / ack-window failure exactly where the click happened. Disabled with
// the honest reason when there is no live backchannel (imported capture,
// disconnected relay). Renders nothing for settled runs.
import { useState } from 'react';
import { CircleDashed, LoaderCircle, OctagonX } from 'lucide-react';
import type { Lane, RunInfo } from '@/core/store';
import { useController } from '@/state/use-store';
import { refusalAdvisory } from '@/components/layout/refusal-advisory';
import { shortSessionId } from '@/lib/aep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export function CancelRunButton({
  lane,
  run,
  compact = false,
  className,
}: {
  lane: Lane;
  run: RunInfo;
  /** Icon-only rendering for tight chrome (the fleet card's run row). */
  compact?: boolean;
  className?: string;
}) {
  const controller = useController();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (run.state !== 'active') return null; // only live work can be cancelled

  // AEP-0002 §4.1: a run may never reach a terminal (interrupts fire no hook
  // on some sources). Once the session has ended there is nothing left to
  // cancel — surface the honest gap instead of an affordance that cannot act.
  if (lane.status === 'ended') {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-faint', className)}
        title={`Run ${run.id} never received a terminal event before the session ended — nothing is left to cancel.`}
      >
        <CircleDashed className="size-3.5" aria-hidden />
        {!compact && 'no terminal'}
      </span>
    );
  }

  const cancellable = controller.canCancelRun(lane.key);
  const disabledReason =
    lane.source.kind === 'import'
      ? 'Imported capture — no live backchannel to cancel over'
      : !cancellable
        ? 'Relay not connected'
        : undefined;

  if (run.cancelling) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-xs text-faint', className)}
        title={`Cancel requested for run ${run.id}; waiting for the run's terminal event on the stream.`}
      >
        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
        {!compact && 'cancelling…'}
      </span>
    );
  }

  const advisory = refusalAdvisory(lane, 'control.cancel');
  const title = disabledReason
    ? `Cancel run — unavailable: ${disabledReason.toLowerCase()}`
    : run.error
      ? `Cancel failed (${run.error}) — try again`
      : (advisory ?? `Cancel run ${run.id}`);

  return (
    <>
      <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
        <Button
          variant={compact ? 'ghost' : 'outline'}
          size={compact ? 'icon' : 'sm'}
          className={cn(
            'text-destructive hover:bg-destructive/10 hover:text-destructive',
            compact && 'size-6',
          )}
          disabled={!!disabledReason}
          title={title}
          aria-label={`Cancel run ${run.id}`}
          onClick={() => setOpen(true)}
        >
          <OctagonX className={cn(compact && 'size-3.5')} aria-hidden />
          {!compact && 'Cancel run'}
        </Button>
        {run.error && (
          // the outcome renders at the click site in EVERY mode — a hover
          // tooltip is not a troubleshooting surface
          <span className="truncate text-xs text-destructive" title={run.error}>
            cancel failed: {run.error}
          </span>
        )}
        {!compact && !run.error && advisory && (
          <span className="truncate text-xs text-severity-warning" title={advisory}>
            refused control.cancel earlier this session
          </span>
        )}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Cancel this run?</DialogTitle>
          <DialogDescription>
            Sends <span className="font-mono">control.cancel</span> for run{' '}
            <span className="font-mono">{run.id}</span> on{' '}
            <span className="font-medium">{lane.agent ?? `#${shortSessionId(lane.session)}`}</span>.
            The agent stays sovereign and may refuse; the run settles only when its terminal event
            arrives on the stream.
          </DialogDescription>
          <Input
            className="mt-3"
            placeholder="Reason (optional — carried to the agent)"
            aria-label="Cancel reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Keep running
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                controller.cancelRun(lane.key, run.id, reason.trim() || undefined);
                setReason('');
                setOpen(false);
              }}
            >
              <OctagonX aria-hidden /> Cancel run
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
