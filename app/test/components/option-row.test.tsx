// The catalog-driven option rows, extended shapes: enum options render a
// dropdown, suggestions ride a datalist (never a constraint), secrets mask,
// and argv-backed options (no env var) ride the same env object with the
// argv string as their key — all still pure DATA from the serve catalog.
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OpsPanel } from '../../src/views/connections/ops-panel';
import { saveOpsConfig, DEFAULT_OPS_URL } from '../../src/state/config';

const codexOptions = [
  { env: 'AEP_CAPTURE', label: 'Capture ceiling', type: 'string', values: ['none', 'metadata', 'redacted', 'full'], default: 'metadata', help: 'Content-capture ceiling for session/tool events.' },
  { env: 'AEP_TARGET', label: 'Relay URL', type: 'string', default: '', suggestions: ['http://127.0.0.1:8787', 'http://127.0.0.1:8790'], help: 'Where emitted events go.' },
  { env: 'AEP_KEY', label: 'Session API key', type: 'string', default: '', secret: true, help: 'Optional key for the auth frame.' },
  { argv: '--vendor', label: 'Vendor profile', type: 'string', default: 'codex', help: 'Which vendor family this receiver maps.' },
];

const opsState = {
  repo: '/somewhere/reference',
  relay: { url: 'http://127.0.0.1:8787', port: 8787, up: true, managed: true },
  agents: [
    {
      id: 'codex', port: 8378, bin: '/usr/local/bin/codex', version: 'codex 1.0',
      minVersion: null, daemon: null, portFree: true,
      managed: false, registered: true, target: '/h/.codex/config.toml', format: 'toml-append', note: null,
      options: codexOptions,
    },
  ],
  bridges: [],
};

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
    if (url.includes('/api/state')) return json(opsState);
    if (url.includes('/api/up')) return json({ ok: true, lines: [] });
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

beforeAll(() => {
  // Radix Select in jsdom: pointer capture + scrollIntoView are unimplemented
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
beforeEach(() => {
  stubStorage();
  stubFetch();
  location.hash = '';
  saveOpsConfig({ url: DEFAULT_OPS_URL, token: 'tok' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openStartDialog() {
  render(<OpsPanel />);
  await waitFor(() => expect(screen.getByTestId('process-codex')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /start codex/i }));
  await waitFor(() => expect(screen.getByText('Capture ceiling')).toBeTruthy());
}

describe('OptionRow extended shapes', () => {
  it('renders an enum option as a select carrying every catalog value', async () => {
    await openStartDialog();
    const trigger = screen.getByRole('combobox', { name: 'AEP_CAPTURE' });
    // current value = the catalog default
    expect(trigger.textContent).toContain('metadata');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    for (const v of ['none', 'metadata', 'redacted', 'full']) {
      expect(await screen.findByRole('option', { name: v })).toBeTruthy();
    }
    // the env-var name + help affordance survive unchanged
    expect(screen.getByLabelText('help for AEP_CAPTURE').getAttribute('title')).toMatch(/capture ceiling/i);
  });

  it('renders a suggestions option as free text with a datalist', async () => {
    await openStartDialog();
    const input = screen.getByLabelText('AEP_TARGET');
    const listId = input.getAttribute('list');
    expect(listId).toBeTruthy();
    const list = document.getElementById(listId!);
    expect(list?.tagName).toBe('DATALIST');
    const values = Array.from(list!.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(values).toEqual(['http://127.0.0.1:8787', 'http://127.0.0.1:8790']);
  });

  it('masks a secret option', async () => {
    await openStartDialog();
    expect(screen.getByLabelText('AEP_KEY').getAttribute('type')).toBe('password');
  });

  it('round-trips an argv-backed option under its argv string key', async () => {
    await openStartDialog();
    fireEvent.change(screen.getByLabelText('--vendor'), { target: { value: 'vscode' } });
    fireEvent.click(screen.getByLabelText(/open fleet filtered/i));
    fireEvent.click(screen.getByRole('button', { name: /run start scenario/i }));
    await waitFor(() => {
      const up = calls.find((c) => c.url.includes('/api/up') && c.method === 'POST');
      expect(up?.body).toMatchObject({ agent: 'codex', env: { '--vendor': 'vscode' } });
    });
    // the CLI receipt names the argv key riding --env
    await waitFor(() =>
      expect(screen.getAllByText(/up codex --env --vendor=vscode/).length).toBeGreaterThan(0));
  });
});
