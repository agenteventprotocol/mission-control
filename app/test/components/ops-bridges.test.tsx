// The class/instance restructure of the Local-stack panel: Adapters |
// Bridges | Relay tabs, one card per bridge in the ops catalog (manual
// bridges are info-only — the server refuses starting them), an Instances
// block on running cards (managed daemon row + sessions seen on the event
// stream), the scenario receipt as a step list with honest per-step state,
// and busy verbs + immediate refresh on card actions.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { OpsPanel } from '../../src/views/connections/ops-panel';
import { saveOpsConfig, DEFAULT_OPS_URL, loadAgentEnv } from '../../src/state/config';
import { ControllerContext } from '../../src/state/use-store';
import { Controller } from '../../src/state/controller';

const bridgeOptions = [
  { argv: '--vendor', label: 'Vendor profile', type: 'string', default: '', help: 'Which vendor profile the receiver decodes.' },
];

const opsState = () => ({
  repo: '/somewhere/reference',
  relay: { url: 'http://127.0.0.1:8787', port: 8787, token: 'tok-relay', up: true, managed: true },
  agents: [
    {
      id: 'hermes', port: 8393, bin: '/usr/local/bin/hermes', version: 'hermes 1.0',
      minVersion: null, daemon: { up: true, relay: true }, portFree: false,
      managed: true, registered: true, target: '/h/.hermes/config.yaml', format: 'yaml', note: null,
      options: [],
    },
    {
      id: 'codex', port: 8378, bin: null, version: null,
      minVersion: null, daemon: null, portFree: true,
      managed: false, registered: true, target: null, format: null, note: null,
      options: [],
    },
  ],
  bridges: [
    {
      id: 'bridge-otlp-in', port: 4318, daemon: null, portFree: true,
      managed: false, options: bridgeOptions,
    },
    {
      id: 'bridge-kilocode-sse', port: 8390, daemon: { up: true, relay: true }, portFree: false,
      managed: true, options: [],
    },
    {
      id: 'bridge-acp', port: 0, daemon: null, managed: false, options: [],
      manual: true, note: 'editor-launched — registered per project, not a daemon here',
    },
  ],
});

let calls: Array<{ url: string; method: string; body?: unknown }> = [];
let upFails = false;
// gate for down/restart responses, so in-flight UI state is inspectable
let gateAction = false;
let releaseAction: (() => void) | null = null;
// what the relay's GET /connections returns — empty by default so cards show
// no parties row unless a test opts in
let relayIntro: {
  ok: boolean;
  relay: { sessions: number; subscribers: number; connections: number; uptime_s: number; control: boolean };
  connections: Array<{
    role: string;
    identity: { agent?: string; instance?: string } | null;
    accepts: string[] | null;
    sessions: string[];
    subscriptions: number;
  }>;
  sse_subscribers: number;
} = { ok: true, relay: { sessions: 0, subscribers: 0, connections: 0, uptime_s: 0, control: false }, connections: [], sse_subscribers: 0 };

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
    if (url.includes('/api/up')) {
      return json(upFails ? { ok: false, error: 'port busy', lines: [] } : { ok: true, lines: [] });
    }
    if (url.includes('/api/down') || url.includes('/api/restart')) {
      if (gateAction) await new Promise<void>((res) => { releaseAction = res; });
      return json({ ok: true, stopped: [], lines: [] });
    }
    if (url.includes('/api/logs')) return json({ name: 'bridge-otlp-in', lines: ['bridge line'] });
    if (url.includes('/connections')) return json(relayIntro);
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
  upFails = false;
  gateAction = false;
  releaseAction = null;
  relayIntro = { ok: true, relay: { sessions: 0, subscribers: 0, connections: 0, uptime_s: 0, control: false }, connections: [], sse_subscribers: 0 };
  location.hash = '';
  saveOpsConfig({ url: DEFAULT_OPS_URL, token: 'tok' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('local-stack tabs', () => {
  it('renders Adapters | Bridges | Relay tabs and switches content', async () => {
    render(<OpsPanel />);
    // default tab: today's agent cards
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Adapters' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Bridges' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Relay' })).toBeTruthy();
    // switching shows the bridge cards and hides the agent cards
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bridges' }));
    await waitFor(() => expect(screen.getByTestId('process-bridge-otlp-in')).toBeTruthy());
    expect(screen.queryByTestId('process-hermes')).toBeNull();
  });
});

async function openBridgesTab() {
  fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Bridges' }));
  await waitFor(() => expect(screen.getByTestId('process-bridge-otlp-in')).toBeTruthy());
}

describe('bridge cards', () => {
  it('offers Start on a down bridge and Stop/Restart/Logs on a managed running one', async () => {
    render(<OpsPanel />);
    await openBridgesTab();
    const otlp = screen.getByTestId('process-bridge-otlp-in');
    expect(otlp.textContent).toMatch(/Start/);
    expect(otlp.textContent).not.toMatch(/\bStop\b/);
    const kilo = screen.getByTestId('process-bridge-kilocode-sse');
    expect(kilo.textContent).toMatch(/Stop/);
    expect(kilo.textContent).toMatch(/Restart/);
    expect(kilo.textContent).toMatch(/Logs/);
    expect(kilo.textContent).toMatch(/managed here/);
  });

  it('starts a bridge with its catalog options as env and remembers them per id', async () => {
    render(<OpsPanel />);
    await openBridgesTab();
    fireEvent.click(screen.getByRole('button', { name: /start bridge-otlp-in/i }));
    // the bridge catalog drives the form; argv-backed keys ride like env
    const input = await screen.findByLabelText('--vendor');
    fireEvent.change(input, { target: { value: 'codex' } });
    // bridges have no registration step to offer
    expect(screen.queryByLabelText(/apply the vendor registration/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() => {
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(up?.body).toMatchObject({ agent: 'bridge-otlp-in', env: { '--vendor': 'codex' } });
    });
    // persisted id-keyed like agent env — Restart re-applies it
    await waitFor(() => expect(loadAgentEnv('bridge-otlp-in')).toEqual({ '--vendor': 'codex' }));
  });

  it('renders a manual bridge as an info-only card: note, README hint, no actions', async () => {
    render(<OpsPanel />);
    await openBridgesTab();
    const acp = screen.getByTestId('process-bridge-acp');
    expect(acp.textContent).toMatch(/editor-launched — registered per project/);
    expect(acp.textContent).toMatch(/impl\/bridge-acp\/README\.md/);
    expect(screen.queryByRole('button', { name: /start bridge-acp/i })).toBeNull();
    expect(acp.textContent).not.toMatch(/\bStop\b/);
  });
});

describe('testing-guide links', () => {
  const GUIDE = 'https://github.com/agenteventprotocol/mission-control/blob/main/docs/testing';

  it('links each agent class card to its per-agent testing guide', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    const card = screen.getByTestId('process-hermes');
    const link = within(card).getByRole('link', { name: /testing guide/i });
    // the card id IS the guide slug — one hop to that agent's checklist
    expect(link.getAttribute('href')).toBe(`${GUIDE}/hermes.md`);
    // opens out of the SPA, safely
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toMatch(/noreferrer/);
    // a card whose CLI is absent still learns where to read
    expect(
      within(screen.getByTestId('process-codex')).getByRole('link', { name: /testing guide/i })
        .getAttribute('href'),
    ).toBe(`${GUIDE}/codex.md`);
  });

  it('deep-links every bridge card — daemon and manual — to its testing guide', async () => {
    render(<OpsPanel />);
    await openBridgesTab();
    const otlp = within(screen.getByTestId('process-bridge-otlp-in'))
      .getByRole('link', { name: /testing guide/i });
    expect(otlp.getAttribute('href')).toBe(`${GUIDE}/bridge-otlp-in.md`);
    // the info-only manual bridge gets the guide link beside its README pointer
    const acp = within(screen.getByTestId('process-bridge-acp'))
      .getByRole('link', { name: /testing guide/i });
    expect(acp.getAttribute('href')).toBe(`${GUIDE}/bridge-acp.md`);
  });
});

describe('busy verbs and immediate refresh', () => {
  it('shows the in-flight verb next to the status dot and refreshes right when the action returns', async () => {
    gateAction = true;
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    const before = calls.filter((c) => c.url.includes('/api/state')).length;
    fireEvent.click(screen.getByRole('button', { name: /stop hermes/i }));
    // the response is gated — the card names what it is doing meanwhile
    expect(screen.getByTestId('process-hermes').textContent).toMatch(/stopping…/);
    act(() => releaseAction?.());
    await waitFor(() =>
      expect(screen.getByTestId('process-hermes').textContent).not.toMatch(/stopping…/));
    // state re-fetched well inside the 5s poll — the immediate refresh path
    await waitFor(() =>
      expect(calls.filter((c) => c.url.includes('/api/state')).length).toBeGreaterThan(before));
  });
});

describe('scenario step list', () => {
  it('renders failed state with the reason and leaves unreached steps pending', async () => {
    upFails = true;
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
    fireEvent.click(await screen.findByRole('button', { name: /run start scenario/i }));
    await waitFor(() =>
      expect(screen.getByTestId('step-start').getAttribute('data-step-state')).toBe('failed'));
    // the failure carries its reason on the step itself
    expect(screen.getByTestId('step-start').textContent).toMatch(/port busy/);
    // the fleet step was never reached — pending, not silently dropped
    expect(screen.getByTestId('step-fleet').getAttribute('data-step-state')).toBe('pending');
  });

  it('marks a green bridge run done — start only, no stream step without a stream consumer', async () => {
    render(<OpsPanel />);
    await openBridgesTab();
    fireEvent.click(screen.getByRole('button', { name: /start bridge-otlp-in/i }));
    fireEvent.click(await screen.findByRole('button', { name: /run start scenario/i }));
    await waitFor(() =>
      expect(screen.getByTestId('step-start').getAttribute('data-step-state')).toBe('done'));
    // no controller is mounted in this render, so there is no stream to connect
    expect(screen.queryByTestId('step-stream')).toBeNull();
  });
});

const mkSession = (agent: string, session: string, seq: number): AepEvent =>
  ({
    aep: '0.1',
    id: `ev_${session}`,
    type: 'session.started',
    time: new Date(1700000000000 + seq * 1000).toISOString(),
    source: `aep://test/${agent}/host`,
    agent,
    session,
    epoch: 1,
    seq,
  }) as AepEvent;

describe('instances block — relay-introspection parties', () => {
  it('shows the parties the relay reports for this class, distinct from store-derived sessions', async () => {
    relayIntro = {
      ok: true,
      relay: { sessions: 2, subscribers: 1, connections: 2, uptime_s: 61, control: true },
      connections: [
        { role: 'emitter', identity: { agent: 'hermes', instance: 'host-1' }, accepts: ['control.attention.respond'], sessions: ['s_1', 's_2'], subscriptions: 0 },
        { role: 'consumer', identity: { agent: 'mission-control', instance: 'web' }, accepts: null, sessions: [], subscriptions: 3 },
      ],
      sse_subscribers: 0,
    };
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    const card = screen.getByTestId('process-hermes');
    // the relay-reported party row for this class, honestly labeled as coming
    // from the relay (not the MC event stream)
    await waitFor(() => expect(within(card).getByText(/on the relay/i)).toBeTruthy());
    expect(card.textContent).toMatch(/@host-1/);
    // the control verbs the relay says this party accepts
    expect(card.textContent).toMatch(/control\.attention\.respond/);
    // its live sessions are openable in Fleet (button text is the id; the
    // title carries the tooltip)
    const s1 = within(card).getByRole('button', { name: 's_1' });
    expect(s1.getAttribute('title')).toMatch(/open session s_1/i);
    fireEvent.click(s1);
    expect(location.hash).toBe('#/sessions/s_1');
    // the mission-control consumer party belongs to no agent card here
    expect(card.textContent).not.toMatch(/web/);
  });

  it('renders no parties row for a class the relay reports nothing for', async () => {
    relayIntro.connections = [
      { role: 'emitter', identity: { agent: 'hermes', instance: 'host-1' }, accepts: [], sessions: [], subscriptions: 0 },
    ];
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    // codex is down and unreported — no daemon row, no parties row
    expect(screen.getByTestId('process-codex').textContent).not.toMatch(/on the relay/i);
  });
});

describe('instances block', () => {
  it('shows the managed daemon row plus sessions seen on the stream, deep-linked to Fleet', async () => {
    const controller = new Controller();
    controller.store.apply(mkSession('hermes', 's_h1', 1));
    render(
      <ControllerContext.Provider value={controller}>
        <OpsPanel />
      </ControllerContext.Provider>,
    );
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    const card = screen.getByTestId('process-hermes');
    await waitFor(() => expect(card.textContent).toMatch(/Instances/));
    // the managed daemon instance row
    expect(card.textContent).toMatch(/managed here/);
    expect(card.textContent).toMatch(/relay connected/);
    // the sessions row is store-derived and says so, honestly
    const link = within(card).getByRole('link', { name: /1 session seen on the stream/i });
    expect(link.getAttribute('href')).toBe('#/fleet?q=hermes');
    // nothing running → no instances block at all
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bridges' }));
    await waitFor(() => expect(screen.getByTestId('process-bridge-otlp-in')).toBeTruthy());
    expect(screen.getByTestId('process-bridge-otlp-in').textContent).not.toMatch(/Instances/);
    // a running bridge gets the daemon instance row even with zero sessions
    expect(screen.getByTestId('process-bridge-kilocode-sse').textContent).toMatch(/Instances/);
  });
});
