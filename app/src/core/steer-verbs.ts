// The session composer's vendor-verb table (AEP-0004 §5, x.{agent}.control.*).
//
// Default: the convergent steering verb — `x.{agent}.control.instruct`
// `{ text }` — advisory context the agent reads on its next model request;
// every adapter that adopts steering shares that shape, so the consumer needs
// no per-vendor table for it. Cline and OpenHands are the deliberate
// divergences (each design record's verb-fit decision): their verbs are
// USER-PLANE input — Cline queues the text as a pending prompt,
// OpenHands appends it as a user message in the conversation (a live run
// picks it up on a later step; the bridge never triggers a run with it) —
// not advisory context, so each gets its own verb, payload, and label.
// Mislabeling them "Steer" would tell the operator the wrong thing
// about what the button does. Discovery stays send-and-settle either way
// (emitter capabilities are not consumer-visible in 0.1): a target that never
// opted in earns the relay's sender-side `unsupported`, surfaced in place.
export interface SteerVerbProfile {
  /** the command `type` to send */
  type: string;
  /** the command payload for one composer text */
  data: (text: string) => Record<string, unknown>;
  /** the action's honest name (button + dialog) */
  label: string;
  /** dialog copy: semantics + settlement, no overclaiming */
  description: string;
  /** the cause-linked Timeline event that proves the outcome */
  deliveredEvent: string;
  /** status line shown once the target acks */
  acceptedNote: string;
}

export function steerVerb(agent: string): SteerVerbProfile {
  if (agent === 'cline') {
    return {
      type: 'x.cline.control.send_input',
      // "queue" appends to the session's pending prompts — the polite
      // default; the wire also accepts "steer" (queue-jump) for API senders
      data: (text) => ({ text, delivery: 'queue' }),
      label: 'Send input',
      description:
        'Submitted to the session as user input — Cline queues it as a ' +
        'pending prompt in the conversation (not advisory context). The ' +
        'daemon must opt in with its hub control leg; a target that has ' +
        'not opted in refuses honestly.',
      deliveredEvent: 'input.sent',
      acceptedNote: 'accepted by the target — the hub-accepted input is audited in the Timeline as',
    };
  }
  if (agent === 'openhands') {
    return {
      type: 'x.openhands.control.send_input',
      // one append plane: no delivery field; the bridge pins the vendor's
      // run flag false, so this never starts work and never answers a
      // pending confirmation
      data: (text) => ({ text }),
      label: 'Send input',
      description:
        'Submitted to the conversation as user input — OpenHands appends it ' +
        'as a user message (not advisory context); a live run picks it up ' +
        'on a later step, an idle or paused conversation keeps it for the ' +
        'next run. The bridge must opt in with its control leg; a target ' +
        'that has not opted in refuses honestly.',
      deliveredEvent: 'input.sent',
      acceptedNote: 'accepted by the target — the appended input is audited in the Timeline as',
    };
  }
  return {
    type: `x.${agent}.control.instruct`,
    data: (text) => ({ text }),
    label: 'Steer',
    description:
      "Queued on the agent's adapter and read on its next model request — " +
      'steering is advisory, and the session decides. Watch the Timeline ' +
      'for the delivered event; a target that has not opted in refuses ' +
      'honestly.',
    deliveredEvent: 'instruction.delivered',
    acceptedNote: 'accepted by the target — delivery lands in the Timeline as',
  };
}
