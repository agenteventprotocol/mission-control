// The observed-refusal advisory, generalized from the attention card to any
// control affordance: once THIS session settled a verb
// refused·unsupported, say so where the next click would happen. ADVISORY
// ONLY — observed capability is stale-able (a restarted target may accept),
// so the send path is never gated; `invalid` never advises, because that
// reason means the verb IS accepted and the answer was malformed. The
// request-scoped respond_via declaration remains the only authoritative
// affordance gate, and it exists only on attention requests.
import type { Lane } from '@/core/store';

export function refusalAdvisory(lane: Lane, verb: string): string | null {
  const settle = lane.control.get(verb);
  return settle?.state === 'refused' && settle.reason === 'unsupported'
    ? `This target refused ${verb} earlier this session (unsupported) — the send stays available in case the target's gate changed, but expect another nack; the agent's own UI holds this decision.`
    : null;
}
