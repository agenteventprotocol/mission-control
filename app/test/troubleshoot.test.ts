// Stream-failure hints: every branch must carry a suggestion the operator
// can act on, and the no-answer branch must reconcile the two vantages —
// the local stack's probe (server-side) and the browser's own reach are
// different facts, and a hint that says "start it" about a running relay
// is worse than no hint at all.
import { describe, expect, it } from 'vitest';
import { streamErrorHint } from '../src/lib/troubleshoot';

describe('streamErrorHint', () => {
  it('keeps the token branch for auth refusals', () => {
    expect(streamErrorHint('SSE HTTP 401')).toMatch(/rejected the token/i);
    expect(streamErrorHint('SSE HTTP 403')).toMatch(/rejected the token/i);
  });

  it('keeps the answered-but-refused branch for other HTTP statuses', () => {
    expect(streamErrorHint('SSE HTTP 431')).toMatch(/refused the request/i);
  });

  it('teaches the forwarded-port cause on network errors', () => {
    // ERR_CONNECTION_REFUSED in the browser surfaces as a TransportError —
    // "is it running?" is one possible cause; a port that is not forwarded
    // to where the page runs (VS Code Remote, WSL, SSH) is the other
    const hint = streamErrorHint('TransportError: Failed to fetch');
    expect(hint).toMatch(/is it running/i);
    expect(hint).toMatch(/forward/i);
  });

  it('names the split vantage when the local stack reports the relay up', () => {
    const hint = streamErrorHint('TransportError: Failed to fetch', { stackReportsUp: true });
    // the stack CAN reach it, the browser cannot: suggesting a start would
    // be misleading — the actionable step is making the port reachable
    expect(hint).toMatch(/forward/i);
    expect(hint).not.toMatch(/is it running/i);
    expect(hint).toMatch(/local stack/i);
    // "forwarded but still failing" is the address-family case (IPv4 vs
    // IPv6 loopback): restarting from the Local stack rebinds the relay to
    // the family its URL names — the hint must name that path
    expect(hint).toMatch(/IPv4|IPv6|address family/i);
    expect(hint).toMatch(/restart/i);
  });

  it('the stack vantage never overrides an HTTP-status diagnosis', () => {
    // an HTTP answer proves the browser reached the relay — the split-
    // vantage reading would be false there
    expect(streamErrorHint('SSE HTTP 401', { stackReportsUp: true })).toMatch(/rejected the token/i);
  });
});
