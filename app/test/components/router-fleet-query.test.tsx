// The `#/fleet?q=<agent>` deep link: parse/round-trip in the hash router,
// and the Fleet view seeding its filter query from the route — the landing
// half of "producer node → Fleet filtered to that agent".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { parseHash, routeHash } from '../../src/state/router';
import { FleetView } from '../../src/views/fleet/fleet-view';
import { ControllerContext } from '../../src/state/use-store';
import { Controller } from '../../src/state/controller';

describe('router: fleet query deep link', () => {
  it('parses #/fleet?q= and round-trips it', () => {
    expect(parseHash('#/fleet?q=hermes')).toEqual({ view: 'fleet', q: 'hermes' });
    expect(parseHash('#/fleet')).toEqual({ view: 'fleet' });
    expect(routeHash({ view: 'fleet', q: 'qwen code' })).toBe('#/fleet?q=qwen%20code');
    expect(parseHash(routeHash({ view: 'fleet', q: 'qwen code' }))).toEqual({ view: 'fleet', q: 'qwen code' });
  });

  it('a query-bearing connections hash still routes to Connections (the serve connect link)', () => {
    expect(parseHash('#/connections?ops=http%3A%2F%2F127.0.0.1%3A8799&opsToken=t')).toEqual({ view: 'connections' });
  });
});

describe('FleetView', () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    location.hash = '';
  });

  it('seeds the filter query from the route', async () => {
    location.hash = '#/fleet?q=hermes';
    const controller = new Controller();
    render(
      <ControllerContext.Provider value={controller}>
        <FleetView />
      </ControllerContext.Provider>,
    );
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/filter by agent/i) as HTMLInputElement;
      expect(input.value).toBe('hermes');
    });
  });
});
