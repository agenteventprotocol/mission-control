// The ops client against the extended /api/state: option keys that may be
// env- or argv-backed, the bridges list (absent on older serve builds), an
// env-carrying restart, and the CLI hints that cover bridges with the same
// verbs the agents use.
import { describe, expect, it, vi } from 'vitest';
import { CLI, OpsClient, optionKey, type OpsAgentOption } from '../src/lib/ops';

function jsonFetch(payload: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

describe('optionKey', () => {
  it('prefers env and falls back to the argv string', () => {
    expect(optionKey({ env: 'AEP_CAPTURE', label: 'c', help: 'h', type: 'string' })).toBe('AEP_CAPTURE');
    expect(optionKey({ argv: '--vendor', label: 'v', help: 'h', type: 'string' })).toBe('--vendor');
    expect(optionKey({ label: 'x', help: 'h', type: 'string' } as OpsAgentOption)).toBe('');
  });
});

describe('OpsClient.state', () => {
  it('degrades a missing bridges list from an older serve build to []', async () => {
    const fetchImpl = jsonFetch({
      repo: '/r',
      relay: { url: 'http://127.0.0.1:8787', up: false, managed: false },
      agents: [],
    });
    const s = await new OpsClient('http://ops', 't', fetchImpl).state();
    expect(s.bridges).toEqual([]);
    // relay.options is absent on older builds too — consumers read it as []
    expect(s.relay.options ?? []).toEqual([]);
  });

  it('passes bridges (managed and manual) through when the serve build reports them', async () => {
    const bridges = [
      { id: 'bridge-kilocode-sse', port: 8390, daemon: { up: true, relay: true }, portFree: false, managed: true, options: [] },
      { id: 'bridge-acp', port: 0, daemon: null, managed: false, options: [], manual: true, note: 'registered per project' },
    ];
    const fetchImpl = jsonFetch({
      repo: '/r',
      relay: { url: 'http://127.0.0.1:8787', up: true, managed: true, options: [] },
      agents: [],
      bridges,
    });
    const s = await new OpsClient('http://ops', 't', fetchImpl).state();
    expect(s.bridges).toEqual(bridges);
  });
});

describe('OpsClient.restart', () => {
  it('carries env when given (relay and bridge restarts re-apply boot options)', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return new Response('{"ok":true,"lines":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new OpsClient('http://ops', 't', fetchImpl);
    await client.restart('relay', { AEP_BUFFER: '2000' });
    expect(bodies[0]).toEqual({ name: 'relay', env: { AEP_BUFFER: '2000' } });
    await client.restart('bridge-kilocode-sse');
    expect(bodies[1]).toEqual({ name: 'bridge-kilocode-sse' });
  });
});

describe('CLI hints', () => {
  it('covers bridge ids with the same verbs and composes restart from down + up', () => {
    // argv-backed overrides ride --env with the argv string as the key
    expect(CLI.up('bridge-kilocode-sse', { '--vendor': 'codex' }))
      .toBe('node impl/setup/aep-setup.js up bridge-kilocode-sse --env --vendor=codex');
    expect(CLI.down('bridge-kilocode-sse')).toBe('node impl/setup/aep-setup.js down bridge-kilocode-sse');
    // the setup CLI has no restart verb — the honest equivalent is down && up
    expect(CLI.restart('relay', { AEP_BUFFER: '2000' }))
      .toBe('node impl/setup/aep-setup.js down relay && node impl/setup/aep-setup.js up relay --env AEP_BUFFER=2000');
    expect(CLI.logs('bridge-kilocode-sse')).toBe('tail -n 200 impl/setup/.run/bridge-kilocode-sse.log');
  });
});
