// Connections view: relay topology browser-direct off the relay's
// introspection endpoint, and the local-stack panel over the setup tool's
// ops API — with the teaching absent-state and the CLI equivalent visible
// on every action (the programmatic path stays the learnable asset).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RelayCard } from '../../src/views/connections/relay-card';
import { OpsPanel } from '../../src/views/connections/ops-panel';
import { ConnectionsView } from '../../src/views/connections/connections-view';
import { Rail } from '../../src/components/layout/rail';
import { saveOpsConfig, DEFAULT_OPS_URL, saveAgentEnv, loadAgentEnv } from '../../src/state/config';
import { ControllerContext } from '../../src/state/use-store';
import { Controller } from '../../src/state/controller';

const relayConnections = {
  ok: true,
  relay: { sessions: 2, subscribers: 1, connections: 2, uptime_s: 61, control: true },
  connections: [
    {
      role: 'emitter',
      identity: { agent: 'hermes', instance: 'host-1' },
      accepts: ['control.attention.respond'],
      sessions: ['s_1', 's_2'],
      subscriptions: 0,
    },
    {
      role: 'consumer',
      identity: { agent: 'mission-control', instance: 'web' },
      accepts: null,
      sessions: [],
      subscriptions: 1,
    },
  ],
  sse_subscribers: 0,
};

const hermesOptions = [
  { env: 'AEP_CAPTURE', label: 'Capture ceiling', type: 'string', default: 'metadata', help: 'Content-capture ceiling for session/tool events.' },
  { env: 'AEP_HERMES_CONTROL', label: 'Operator gate', type: 'flag', default: '0', help: 'Hold gated tool calls for a consumer decision.' },
  { env: 'AEP_HERMES_GATE_TOOLS', label: 'Gated tools (regex)', type: 'string', default: '.*', help: 'Regex of tool names the operator gate holds.' },
];
const codexOptions = [
  { env: 'AEP_CAPTURE', label: 'Capture ceiling', type: 'string', default: 'metadata', help: 'Content-capture ceiling for session/tool events.' },
  { env: 'AEP_INSTRUCT', label: 'Steering (instruct)', type: 'flag', default: '0', help: 'Accept the steering verb (opt-in).' },
  { env: 'AEP_ATTENTION_TIMEOUT_MS', label: 'Attention timeout (ms)', type: 'number', default: '55000', help: 'How long an attention request stays answerable.' },
];

const opsState = {
  repo: '/somewhere/reference',
  relay: { url: 'http://127.0.0.1:8787', port: 8787, token: 'tok-relay', up: true, managed: true },
  agents: [
    {
      id: 'hermes', port: 8393, bin: '/usr/local/bin/hermes', version: 'hermes 1.0',
      minVersion: null, daemon: { up: true, relay: true }, portFree: false,
      managed: true, registered: true, target: '/h/.hermes/config.yaml', format: 'yaml', note: null,
      options: hermesOptions,
    },
    {
      id: 'codex', port: 8378, bin: null, version: null,
      minVersion: null, daemon: null, portFree: true,
      managed: false, registered: false, target: '/h/.codex/config.toml', format: 'toml-append', note: null,
      options: codexOptions,
    },
  ],
  bridges: [
    {
      id: 'bridge-otlp-in', port: 4318, daemon: { up: true, relay: true }, portFree: false,
      managed: true, options: [],
    },
  ],
};

let calls: Array<{ url: string; method: string; body?: unknown }> = [];
let opsDown = false;
let opsRelayDown = false;
// The split-vantage failure: every browser-side request to the relay itself
// refuses (its port is not reachable from where the page runs), while the
// ops API — a different port — still answers and reports the relay up.
let relayUnreachable = false;

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
    if (relayUnreachable && url.startsWith('http://127.0.0.1:8787')) throw new TypeError('Failed to fetch');
    if (url.includes('/connections?')) return json(relayConnections);
    if (opsDown) throw new Error('ECONNREFUSED');
    if (url.includes('/api/state')) {
      return json(opsRelayDown
        ? { ...opsState, relay: { ...opsState.relay, up: false, managed: false } }
        : opsState);
    }
    if (url.includes('/api/print')) {
      return json({ agent: 'codex', port: 8378, target: '/h/.codex/config.toml', format: 'toml-append', note: 'trust via /hooks', content: '[[hooks.pre]]\ncommand = "node codex-hook.js"' });
    }
    if (url.includes('/api/write')) return json({ agent: 'codex', changed: true, saved: '/h/.codex/config.toml.aep-backup-x' });
    if (url.includes('/api/logs')) return json({ name: 'hermes', lines: ['line 29', 'line 30'] });
    if (url.includes('/api/up') || url.includes('/api/down') || url.includes('/api/restart')) {
      return json({ ok: true, stopped: [], lines: [] });
    }
    return new Response('{}', { status: 404 });
  }));
}

// This jsdom lacks localStorage (the config module's injectable-storage
// seam exists for exactly that) — stub one Map-backed store per test so the
// controller and the panels read/write the SAME persisted config.
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
  // the rail's theme initializer reads matchMedia; jsdom has none
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  opsDown = false;
  opsRelayDown = false;
  relayUnreachable = false;
  location.hash = '';
  saveOpsConfig({ url: DEFAULT_OPS_URL, token: 'tok' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RelayCard', () => {
  it('renders relay vitals and the connected parties from the introspection endpoint', async () => {
    render(<RelayCard relay={{ url: 'http://127.0.0.1:8787', token: 't' }} />);
    // the topology node and the party list both name the agent
    await waitFor(() => expect(screen.getAllByText('hermes').length).toBeGreaterThan(0));
    expect(screen.getAllByText('mission-control').length).toBeGreaterThan(0);
    expect(screen.getByText('control.attention.respond')).toBeTruthy();
    // vitals: sessions / subscribers / connections counts (the topology
    // node sub-label repeats the session count — both are asserted present)
    expect(screen.getAllByText(/2 sessions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2 connections/i).length).toBeGreaterThan(0);
  });
});

describe('OpsPanel', () => {
  it('teaches the serve command when the ops API is unreachable', async () => {
    opsDown = true;
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByText(/aep-setup\.js serve/)).toBeTruthy());
  });

  it('renders process cards with honest managed/unmanaged actions and CLI equivalents', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByText('hermes')).toBeTruthy());
    // managed + up → Stop and Restart offered
    const hermesCard = screen.getByTestId('process-hermes');
    expect(hermesCard.textContent).toMatch(/Stop/);
    expect(hermesCard.textContent).toMatch(/Restart/);
    // down + unmanaged → Start offered, no Stop
    const codexCard = screen.getByTestId('process-codex');
    expect(codexCard.textContent).toMatch(/Start/);
    expect(codexCard.textContent).not.toMatch(/\bStop\b/);
    // the CLI equivalent rides the action affordance
    expect(codexCard.innerHTML).toContain('aep-setup.js up codex');
  });

  it('starts a daemon through the ops API and shows the CLI line it mirrors', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    // Start opens the scenario dialog (options + receipts); its primary
    // button runs the flow with the defaults — still terminal-free.
    fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /run start scenario/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/up') && c.method === 'POST')).toBe(true));
  });

  it('renders the runtime-options catalog with hover help and sends touched options as env', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
    // catalog-driven form: labels + env names + a "?" affordance carrying help
    await waitFor(() => expect(screen.getByText('Steering (instruct)')).toBeTruthy());
    const help = screen.getByLabelText('help for AEP_INSTRUCT');
    expect(help.getAttribute('title')).toMatch(/steering verb/i);
    fireEvent.click(screen.getByLabelText('AEP_INSTRUCT'));
    // keep the dialog open so the receipt is inspectable (a green run with
    // "Open Fleet" checked navigates away — that is the designed flow)
    fireEvent.click(screen.getByLabelText(/open fleet filtered/i));
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() => {
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(up?.body).toMatchObject({ agent: 'codex', env: { AEP_INSTRUCT: '1' } });
    });
    // the receipt names the CLI line the scenario mirrored, env included
    await waitFor(() =>
      expect(screen.getAllByText(/up codex --env AEP_INSTRUCT=1/).length).toBeGreaterThan(0));
  });

  it('remembers the env a green start scenario used, per agent', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
    await waitFor(() => expect(screen.getByText('Steering (instruct)')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('AEP_INSTRUCT'));
    fireEvent.click(screen.getByLabelText(/open fleet filtered/i));
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/up') && c.method === 'POST')).toBe(true));
    // the panel now knows how this agent was last booted
    await waitFor(() => expect(loadAgentEnv('codex')).toEqual({ AEP_INSTRUCT: '1' }));
  });

  it('Restart re-applies the remembered start options instead of silently dropping them', async () => {
    // A restart that reboots the daemon with a bare env would un-flag a
    // daemon the operator started with (say) the steering toggle on — a
    // rebooted daemon keeps only its boot-time env. With remembered options
    // the button composes down + up(env) and says so.
    saveAgentEnv('hermes', { AEP_INSTRUCT: '1' });
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    const btn = screen.getByRole('button', { name: /restart hermes/i });
    expect(btn.getAttribute('title')).toMatch(/--env AEP_INSTRUCT=1/);
    fireEvent.click(btn);
    await waitFor(() => {
      const down = calls.find((c) => c.url.includes('/api/down') && c.method === 'POST');
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(down?.body).toMatchObject({ name: 'hermes' });
      expect(up?.body).toMatchObject({ agent: 'hermes', env: { AEP_INSTRUCT: '1' } });
    });
    expect(calls.some((c) => c.url.includes('/api/restart'))).toBe(false);
  });

  it('Restart without remembered options keeps the plain restart path', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /restart hermes/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/restart') && c.method === 'POST')).toBe(true));
    expect(calls.some((c) => c.url.includes('/api/down'))).toBe(false);
  });

  it('registers before starting when the scenario asks for it, as a visible receipt step', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
    // codex is unregistered in the fixture; the register step is offered ON
    await waitFor(() => expect(screen.getByLabelText(/apply the vendor registration/i)).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/open fleet filtered/i));
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/write') && c.method === 'POST')).toBe(true));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/up') && c.method === 'POST')).toBe(true));
    // receipt lines for both steps, CLI-named
    expect(screen.getAllByText(/write codex/).length).toBeGreaterThan(0);
  });

  it('offers an optional project directory on project-scoped registrations', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /configure codex/i }));
    await waitFor(() => expect(screen.getByText(/toml-append/)).toBeTruthy());
    const dir = screen.getByLabelText(/project directory/i);
    fireEvent.change(dir, { target: { value: '/work/proj' } });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/print') && c.url.includes('projectDir=%2Fwork%2Fproj'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /apply registration/i }));
    await waitFor(() => {
      const w = calls.find((c) => c.url.includes('/api/write') && c.method === 'POST');
      expect(w?.body).toMatchObject({ agent: 'codex', projectDir: '/work/proj' });
    });
  });

  it('offers Start relay when the relay is down', async () => {
    opsRelayDown = true;
    render(<OpsPanel />);
    // the relay row lives in the Local-stack Relay tab now
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Relay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /start relay/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /start relay/i }));
    await waitFor(() => {
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(up?.body).toMatchObject({ agent: 'relay' });
    });
  });

  it('adopts the ops relay into the stream config automatically — zero clicks, visibly', async () => {
    // the status-truth case, matured: connecting the ops endpoint IS the
    // consent to mirror its stack (the ops token already controls that
    // relay), so the stream token is adopted without a second decision —
    // and the adoption is a visible receipt, never a silent write
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: '' }] }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <OpsPanel />
      </ControllerContext.Provider>,
    );
    await waitFor(() =>
      expect(controller.config.relays.find((r) => r.url === 'http://127.0.0.1:8787')?.token).toBe('tok-relay'));
    // the adoption names itself, and the row reports the SAME stream state
    // the rail dot uses
    await waitFor(() => expect(screen.getByText(/adopted from the local stack/i)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/mission control stream/i)).toBeTruthy());
  });

  it('teaches the connect link in the unreachable state', async () => {
    opsDown = true;
    render(<OpsPanel />);
    // the absent-state now teaches the zero-paste path: serve prints a
    // clickable connect link (the manual paste stays available)
    await waitFor(() => expect(screen.getByText(/connect link/i)).toBeTruthy());
  });
});

describe('stream failure troubleshooting', () => {
  it('renders the failure detail with a suggestion instead of a bare error', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: 'x' }] }));
    const controller = new Controller();
    controller.statuses.set('http://127.0.0.1:8787', { state: 'error', detail: 'SSE HTTP 401' });
    render(
      <ControllerContext.Provider value={controller}>
        <RelayCard relay={{ url: 'http://127.0.0.1:8787', token: 'x' }} />
      </ControllerContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/SSE HTTP 401/)).toBeTruthy());
    expect(screen.getByText(/rejected the token/i)).toBeTruthy();
  });

  it('suggests checking the relay when nothing answers', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: 'x' }] }));
    const controller = new Controller();
    controller.statuses.set('http://127.0.0.1:8787', { state: 'error', detail: 'TransportError: fetch failed' });
    render(
      <ControllerContext.Provider value={controller}>
        <RelayCard relay={{ url: 'http://127.0.0.1:8787', token: 'x' }} />
      </ControllerContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/is it running/i)).toBeTruthy());
  });

  it('reconciles the vantages: the stack reports the relay up, the browser cannot reach it', async () => {
    // a live-reproduced failure mode: serve's probe (its own
    // host) says up, the bridge adopts the token — but every browser-side
    // request to the relay port refuses (the port is not forwarded to where
    // the page runs). "Is it running?" would be misleading: it IS running.
    // The honest hint names the split and says to forward the port.
    relayUnreachable = true;
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: '' }] }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <ConnectionsView />
      </ControllerContext.Provider>,
    );
    // adoption still happens (the ops API answers; it reports the relay up)
    await waitFor(() => expect(screen.getByText(/adopted from the local stack/i)).toBeTruthy(), { timeout: 3000 });
    // the relay card must reconcile: no start suggestion, forward the port
    await waitFor(() => {
      expect(screen.getAllByText(/forward/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/local stack/i).length).toBeGreaterThan(0);
    }, { timeout: 4000 });
    await waitFor(() => expect(screen.queryByText(/is it running/i)).toBeNull());
  });

  it('the bridge row shows the failure hint visibly, not only on hover', async () => {
    relayUnreachable = true;
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: '' }] }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <OpsPanel />
      </ControllerContext.Provider>,
    );
    await waitFor(() => expect(screen.getByText(/adopted from the local stack/i)).toBeTruthy(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByText(/mission control stream: error/i)).toBeTruthy(), { timeout: 4000 });
    // OpsPanel alone renders no relay card, so a `/forward/i` text match can
    // only come from the bridge row rendering the hint as text content, not
    // as a hover-only tooltip attribute
    await waitFor(() => expect(screen.getAllByText(/forward/i).length).toBeGreaterThan(0), { timeout: 4000 });
  });
});

describe('inline relay management (the one Connections surface)', () => {
  it('edits the relay set on the page — no separate dialog', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: '' }] }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <ConnectionsView />
      </ControllerContext.Provider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /manage relays/i }));
    const url = await screen.findByLabelText('Relay URL');
    fireEvent.change(url, { target: { value: 'http://127.0.0.1:9787' } });
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() =>
      expect(controller.config.relays.some((r) => r.url === 'http://127.0.0.1:9787')).toBe(true));
  });
});

describe('ConnectionsView', () => {
  it('renders the cross-relay overview with ports, the Mission Control node, and the managed link', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({
      relays: [
        { url: 'http://127.0.0.1:8787', token: 't', label: 'local' },
        { url: 'http://127.0.0.1:8790', token: 't2' },
      ],
    }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <ConnectionsView />
      </ControllerContext.Provider>,
    );
    await waitFor(() => expect(screen.getAllByText(/:8787/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/:8790/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/mission control/i).length).toBeGreaterThan(0);
    // the ops-managed relay is linked to its card, ambiguity gone
    await waitFor(() => expect(screen.getAllByText(/managed by local stack/i).length).toBeGreaterThan(0));
    // the live ops bridge rides the Agents column as a producer chip
    await waitFor(() => expect(screen.getAllByText('otlp-in').length).toBeGreaterThan(0));
  });

  it('the overview reads as columns with a legend — not an unlabeled picture', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({
      relays: [{ url: 'http://127.0.0.1:8787', token: 't', label: 'local' }],
    }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <ConnectionsView />
      </ControllerContext.Provider>,
    );
    const overview = await screen.findByTestId('overview-topology');
    // column headers name what each column IS
    expect(overview.textContent).toMatch(/Agents/);
    expect(overview.textContent).toMatch(/Relays/);
    expect(overview.textContent).toMatch(/Mission Control/);
    // the legend explains the edge colors in plain words
    expect(overview.textContent).toMatch(/events flowing/i);
    expect(overview.textContent).toMatch(/not connected/i);
  });
});

describe('Topology navigation', () => {
  it('navigates from an overview producer node to Fleet filtered to that agent', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({
      relays: [{ url: 'http://127.0.0.1:8787', token: 't' }],
    }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <ConnectionsView />
      </ControllerContext.Provider>,
    );
    const node = await screen.findByRole('button', { name: /open hermes in fleet/i });
    fireEvent.click(node);
    expect(location.hash).toBe('#/fleet?q=hermes');
  });

  it('previews a registration before writing it, then applies through the ops API', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /configure codex/i }));
    await waitFor(() => expect(screen.getByText(/codex-hook\.js/)).toBeTruthy());
    expect(screen.getByText(/toml-append/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /apply registration/i }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/write') && c.method === 'POST')).toBe(true));
    await waitFor(() => expect(screen.getByText(/backup at/i)).toBeTruthy());
  });

  it('tails a managed process log', async () => {
    render(<OpsPanel />);
    await waitFor(() => expect(screen.getByTestId('process-hermes')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /logs hermes/i }));
    await waitFor(() => expect(screen.getByText(/line 30/)).toBeTruthy());
  });
});

describe('rail settings entry', () => {
  it('the gear navigates to the Connections page — one surface, no twin dialog', async () => {
    localStorage.setItem('aep-mc:config', JSON.stringify({ relays: [{ url: 'http://127.0.0.1:8787', token: '' }] }));
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <Rail notifyEnabled={false} onNotifyToggle={() => {}} />
      </ControllerContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /relays & connections/i }));
    expect(location.hash).toBe('#/connections');
  });
});
