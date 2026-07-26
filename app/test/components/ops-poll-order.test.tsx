// An older in-flight /api/state response landing after a newer one must be
// dropped: with a slow ops server two polls overlap, and applying the stale
// payload re-flaps every card even though the fresh truth already rendered.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OpsPanel } from '../../src/views/connections/ops-panel';
import { saveOpsConfig, DEFAULT_OPS_URL } from '../../src/state/config';

const payload = (up: boolean) => ({
  repo: '/somewhere/reference',
  relay: { url: 'http://127.0.0.1:8787', port: 8787, token: 'tok-relay', up: false, managed: false, options: [] },
  agents: [{
    id: 'hermes', port: 8393, bin: '/usr/local/bin/hermes', version: 'hermes 1.0',
    minVersion: null, daemon: up ? { up: true, relay: true } : null, portFree: false,
    managed: false, registered: true, target: '/h/.hermes/config.yaml', format: 'yaml', note: null,
    options: [],
  }],
  bridges: [],
});

let stateResolvers: Array<(v: Response) => void> = [];
const json = (p: unknown) =>
  new Response(JSON.stringify(p), { status: 200, headers: { 'content-type': 'application/json' } });
const answer = (i: number, p: unknown) => {
  const resolve = stateResolvers[i];
  if (!resolve) throw new Error(`no pending /api/state call #${i}`);
  resolve(json(p));
};

beforeEach(() => {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
  stateResolvers = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/state')) return new Promise<Response>((res) => stateResolvers.push(res));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
  location.hash = '';
  saveOpsConfig({ url: DEFAULT_OPS_URL, token: 'tok' });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
  vi.unstubAllGlobals();
});

describe('ops state poll ordering', () => {
  it('drops a stale out-of-order /api/state response', async () => {
    render(<OpsPanel />);
    await act(async () => {});
    expect(stateResolvers.length).toBe(1);
    // the next interval poll overlaps the still-unanswered first one
    act(() => { vi.advanceTimersByTime(5000); });
    await act(async () => {});
    expect(stateResolvers.length).toBe(2);
    // the newer poll answers first: hermes is up
    await act(async () => { answer(1, payload(true)); });
    expect(screen.getByText('daemon up, relay connected')).toBeTruthy();
    // the older response lands late with a stale busy posture — never rendered
    await act(async () => { answer(0, payload(false)); });
    expect(screen.queryByText(/busy \(not our daemon\)/)).toBeNull();
    expect(screen.getByText('daemon up, relay connected')).toBeTruthy();
  });
});
