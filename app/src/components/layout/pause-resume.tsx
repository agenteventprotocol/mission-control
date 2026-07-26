// Session-scoped pause/resume affordances (AEP-0004 §5 core verbs): two
// direct sends, no confirm dialog — both verbs are non-destructive and
// reversible, and the target refuses anything dishonest (pausing nothing,
// resuming into new work, resuming past a pending confirmation). The refusal
// IS the correct answer, surfaced inline where the send happened — the
// cancel/steer discipline. The consumer cannot durably know a session's
// paused state at the metadata capture ceiling, so no paused badge is
// invented: the accepted note points at the cause-linked outcome event in
// the Timeline, which is the only honest proof the pause (or resume) landed.
import { useState } from 'react';
import { LoaderCircle, Pause, Play } from 'lucide-react';
import type { Lane } from '@/core/store';
import { useController } from '@/state/use-store';
import { refusalAdvisory } from '@/components/layout/refusal-advisory';
import { shortSessionId } from '@/lib/aep';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending'; verb: 'pause' | 'resume' }
  | { kind: 'accepted'; verb: 'pause' | 'resume' }
  | { kind: 'refused'; verb: 'pause' | 'resume'; reason: string };

export function PauseResumeControls({ lane, className }: { lane: Lane; className?: string }) {
  const controller = useController();
  const [state, setState] = useState<SendState>({ kind: 'idle' });

  const usable = controller.canPauseResume(lane.key);
  const disabledReason =
    lane.source.kind === 'import'
      ? 'Imported capture — no live backchannel'
      : !usable
        ? 'Relay not connected'
        : undefined;

  const send = async (verb: 'pause' | 'resume') => {
    setState({ kind: 'sending', verb });
    try {
      if (verb === 'pause') await controller.pauseSession(lane.key);
      else await controller.resumeSession(lane.key);
      setState({ kind: 'accepted', verb });
    } catch (err) {
      setState({
        kind: 'refused',
        verb,
        reason: String(err instanceof Error ? err.message : err),
      });
    }
  };

  return (
    <span className={cn('flex items-center gap-1.5', className)}>
      {(['pause', 'resume'] as const).map((verb) => (
        <Button
          key={verb}
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!!disabledReason || state.kind === 'sending'}
          title={
            disabledReason
              ? `${verb} — unavailable: ${disabledReason.toLowerCase()}`
              : (refusalAdvisory(lane, `control.${verb}`)
                ?? `control.${verb} for session ${shortSessionId(lane.session)} — the target may refuse; the cause-linked outcome in the Timeline is the proof`)
          }
          aria-label={`${verb === 'pause' ? 'Pause' : 'Resume'} session ${lane.session}`}
          onClick={() => void send(verb)}
        >
          {state.kind === 'sending' && state.verb === verb ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : verb === 'pause' ? (
            <Pause className="size-3.5" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          {verb === 'pause' ? 'Pause' : 'Resume'}
        </Button>
      ))}
      {state.kind === 'refused' && (
        <span className="text-xs text-destructive" role="alert">
          {state.verb} refused: {state.reason}
        </span>
      )}
      {state.kind === 'accepted' && (
        <span className="text-xs text-faint" role="status">
          {state.verb} accepted — settled by the cause-linked state update in the Timeline
        </span>
      )}
    </span>
  );
}
