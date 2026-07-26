// The relay row's runtime-options form: the same catalog-driven pattern the
// agent start dialog uses, collapsed behind an Options disclosure — values
// ride as env on Start relay and Restart, persist like agent env, and a
// restart re-applies the remembered caps (a rebooted relay keeps only its
// boot-time env).
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpsPanel } from '../../src/views/connections/ops-panel';
import { saveOpsConfig, DEFAULT_OPS_URL, saveAgentEnv, loadAgentEnv } from '../../src/state/config';

const relayOptions = [
  { env: 'AEP_BUFFER', label: 'Replay buffer depth', type: 'number', default: '10000', help: 'Events retained per session for replay/resume.' },
  { env: 'AEP_MAX_SESSIONS', label: 'Session cap', type: 'number', default: '500', help: 'Maximum concurrently-buffered sessions.' },
  { env: 'AEP_MAX_BODY', label: 'Ingest byte cap', type: 'number', default: '16777216', help: 'Largest accepted ingest request in bytes.' },
  { env: 'AEP_MAX_BATCH', label: 'Ingest batch cap', type: 'number', default: '10000', help: 'Maximum events per ingest request.' },
  { env: 'AEP_MAX_FROM', label: 'Resume-position cap', type: 'number', default: '500', help: 'Maximum resume positions in one subscribe from.' },
];

let relayUp = false;

const opsState = () => ({
  repo: '/somewhere/reference',
  relay: {
    url: 'http://127.0.0.1:8787', port: 8787,
    up: relayUp, managed: relayUp,
    options: relayOptions,
  },
  agents: [],
  bridges: [],
});

let calls: Array<{ url: string; method: string; body?: unknown }> = [];

function stubFetch() {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (typeof init?.body === 'string') {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    calls.push({ url, method, body });
    const json = (payload: unknown) =>
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/api/state')) return json(opsState());
    if (url.includes('/api/up') || url.includes('/api/restart')) return json({ ok: true, lines: [] });
    return new Response('{}', { status: 404 });
  }));
}

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

beforeEach(() => {
  stubStorage();
  stubFetch();
  relayUp = false;
  location.hash = '';
  saveOpsConfig({ url: DEFAULT_OPS_URL, token: 'tok' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The relay row now lives in the Local-stack Relay tab — open it first. */
async function openRelayTab() {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Relay' }));
}

describe('relay options form', () => {
  it('discloses the five caps from the relay catalog — collapsed by default', async () => {
    render(<OpsPanel />);
    await openRelayTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /start relay/i })).toBeTruthy());
    // collapsed: no option row rendered yet
    expect(screen.queryByLabelText('AEP_BUFFER')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /relay options/i }));
    for (const o of relayOptions) {
      expect(screen.getByLabelText(o.env)).toBeTruthy();
      expect(screen.getByText(o.label)).toBeTruthy();
    }
  });

  it('sends touched caps as env on Start relay and remembers them', async () => {
    render(<OpsPanel />);
    await openRelayTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /start relay/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /relay options/i }));
    fireEvent.change(screen.getByLabelText('AEP_BUFFER'), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: /start relay/i }));
    await waitFor(() => {
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(up?.body).toEqual({ agent: 'relay', env: { AEP_BUFFER: '2000' } });
    });
    // persisted the same way agent env is — restart can re-apply it
    await waitFor(() => expect(loadAgentEnv('relay')).toEqual({ AEP_BUFFER: '2000' }));
  });

  it('Restart re-applies the remembered relay env instead of silently dropping it', async () => {
    relayUp = true;
    saveAgentEnv('relay', { AEP_MAX_BODY: '123' });
    render(<OpsPanel />);
    await openRelayTab();
    await waitFor(() => expect(screen.getByRole('button', { name: /restart relay/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /restart relay/i }));
    await waitFor(() => {
      const restart = calls.find((c) => c.url.includes('/api/restart') && c.method === 'POST');
      expect(restart?.body).toEqual({ name: 'relay', env: { AEP_MAX_BODY: '123' } });
    });
  });
});
