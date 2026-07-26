// Fleet's empty state is a TEACHING state (abstraction first, technical
// detail on failure): a stream error names itself with a
// suggestion and points at Connections; a healthy-but-quiet fleet says
// what it is waiting for and where to start an agent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FleetView } from '../../src/views/fleet/fleet-view';
import { ControllerContext } from '../../src/state/use-store';
import { Controller } from '../../src/state/controller';

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
  location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Fleet empty states teach', () => {
  it('a stream error surfaces with its detail and a path to Connections', () => {
    const controller = new Controller();
    controller.statuses.set('http://127.0.0.1:8787', { state: 'error', detail: 'SSE HTTP 401' });
    render(
      <ControllerContext.Provider value={controller}>
        <FleetView />
      </ControllerContext.Provider>,
    );
    expect(screen.getByText(/event stream error/i)).toBeTruthy();
    expect(screen.getByText(/SSE HTTP 401/)).toBeTruthy();
    // the suggestion, not just the state
    expect(screen.getByText(/rejected the token/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /open connections/i })).toBeTruthy();
  });

  it('a live-but-quiet fleet says it is waiting and where to start an agent', () => {
    const controller = new Controller();
    controller.statuses.set('http://127.0.0.1:8787', { state: 'live' });
    render(
      <ControllerContext.Provider value={controller}>
        <FleetView />
      </ControllerContext.Provider>,
    );
    expect(screen.getByText(/waiting for agent events/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /open connections/i })).toBeTruthy();
  });
});
