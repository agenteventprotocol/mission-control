// Failure-first help (technical detail on demand or on failure, as
// troubleshooting suggestions): map a stream failure's detail string to
// a plain-language suggestion. The detail carries the HTTP status when the
// relay answered (the SDK's TransportError message), nothing when the
// request never got through.
export function streamErrorHint(detail?: string, ctx?: { stackReportsUp?: boolean }): string {
  const status = /SSE HTTP (\d+)/.exec(detail ?? '')?.[1];
  if (status === '401' || status === '403') {
    return "The relay rejected the token. If the Local stack below manages this relay, its current token is adopted automatically — otherwise update this relay's token under Manage relays.";
  }
  if (status) {
    return `The relay answered but refused the request (HTTP ${status}) — the URL is right; Mission Control keeps retrying and recovers on its own where it can.`;
  }
  if (ctx?.stackReportsUp) {
    // The local stack's probe (from ITS host) and the browser's reach are
    // different vantage points: an up relay the browser cannot reach means
    // the port is not reachable from where this page runs — suggesting a
    // start would mislead. Two causes, both actionable: the port is not
    // forwarded, OR it is forwarded but on a different address family than
    // the URL (a dual-stack relay's loopback mirror surfaces as IPv6 ::1
    // while http://127.0.0.1 pins IPv4) — restarting from the Local stack
    // rebinds the relay to the family its URL names.
    return 'The local stack reaches this relay, but the browser cannot. If Mission Control is opened through a forwarded port (VS Code Remote, WSL, SSH), forward the relay port too. If it is already forwarded and still failing, the relay may be listening on a different address family than its URL (IPv4 vs IPv6) — restart it from the Local stack below, which binds it to match. The stream recovers on its own once the port answers.';
  }
  return 'No answer from the relay at this URL — is it running? Start it from the Local stack below, or check the port. If it is running but Mission Control is opened through a forwarded port (VS Code Remote, WSL, SSH), forward the relay port too.';
}
