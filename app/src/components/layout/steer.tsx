// Session-scoped steering affordance (the vendor-verb path of AEP-0004 §5):
// sends the lane's steer-verb profile (core/steer-verbs.ts) with one text,
// settling on the stream like every command — resolved on the target's ack,
// refused with the honest reason right where the send happened (a target
// that never opted in earns the relay's sender-side `unsupported`; that
// refusal IS the correct answer, the cancel discipline applied). The label,
// copy, and outcome-event name come from the profile, because the verbs
// genuinely differ: instruct is advisory context read on the agent's next
// model request; Cline's send_input is user-plane input. The cause-linked
// outcome event in the Timeline is the proof — this composer never claims it.
import { useState } from 'react';
import { LoaderCircle, MessageSquarePlus } from 'lucide-react';
import type { Lane } from '@/core/store';
import { steerVerb } from '@/core/steer-verbs';
import { useController } from '@/state/use-store';
import { refusalAdvisory } from '@/components/layout/refusal-advisory';
import { shortSessionId } from '@/lib/aep';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'accepted' }
  | { kind: 'refused'; reason: string };

export function SteerButton({ lane, className }: { lane: Lane; className?: string }) {
  const controller = useController();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [state, setState] = useState<SendState>({ kind: 'idle' });

  const steerable = controller.canInstruct(lane.key);
  const verb = steerVerb(lane.agent ?? '');
  const disabledReason =
    lane.source.kind === 'import'
      ? 'Imported capture — no live backchannel to steer over'
      : !steerable
        ? 'Relay not connected'
        : undefined;

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState({ kind: 'sending' });
    try {
      await controller.instruct(lane.key, trimmed);
      setState({ kind: 'accepted' });
      setText('');
    } catch (err) {
      setState({ kind: 'refused', reason: String(err instanceof Error ? err.message : err) });
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn('gap-1.5', className)}
        disabled={!!disabledReason}
        title={
          disabledReason
            ? `${verb.label} — unavailable: ${disabledReason.toLowerCase()}`
            : (refusalAdvisory(lane, verb.type)
              ?? `${verb.label}: ${lane.agent ?? 'the agent'} (session ${shortSessionId(lane.session)})`)
        }
        aria-label={`${verb.label} for session ${lane.session}`}
        onClick={() => {
          setState({ kind: 'idle' });
          setOpen(true);
        }}
      >
        <MessageSquarePlus className="size-3.5" aria-hidden />
        {verb.label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>
            {verb.label} — {lane.agent ?? 'agent'}
          </DialogTitle>
          <DialogDescription>{verb.description}</DialogDescription>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder={verb.label === 'Send input' ? 'Input for the session…' : 'Instruction for the agent…'}
            aria-label={`${verb.label} text`}
            className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {state.kind === 'refused' && (
            <p className="text-xs text-destructive" role="alert">
              refused: {state.reason}
            </p>
          )}
          {state.kind === 'accepted' && (
            <p className="text-xs text-faint" role="status">
              {verb.acceptedNote} <code>{verb.deliveredEvent}</code>
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                Close
              </Button>
            </DialogClose>
            <Button size="sm" disabled={state.kind === 'sending' || !text.trim()} onClick={send}>
              {state.kind === 'sending' ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> sending…
                </>
              ) : (
                'Send'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
