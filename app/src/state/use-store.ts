// React bindings over the framework-free store/controller. Store
// notifications are coalesced on requestAnimationFrame so a burst of events
// costs one render, and components subscribe at lane granularity where it
// matters (fleet cards).
import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { Store, Lane } from '../core/store.js';
import type { Controller, ConnectionStatus } from './controller.js';

export const ControllerContext = createContext<Controller | null>(null);

export function useController(): Controller {
  const controller = useContext(ControllerContext);
  if (!controller) throw new Error('ControllerContext missing');
  return controller;
}

/**
 * Optional-context variant for leaf chrome (relay chips): renders nothing
 * source-specific when no controller is mounted (bare component tests).
 */
export function useOptionalController(): Controller | null {
  return useContext(ControllerContext);
}

function rafBatched(subscribe: (fn: () => void) => () => void) {
  return (onChange: () => void) => {
    let raf = 0;
    const unsub = subscribe(() => {
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          onChange();
        });
      }
    });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      unsub();
    };
  };
}

/** Re-render (rAF-batched) whenever anything in the store changes. */
export function useStoreVersion(store: Store): number {
  const subscribe = useCallback(
    (onChange: () => void) => rafBatched((fn) => store.subscribe(fn))(onChange),
    [store],
  );
  return useSyncExternalStore(subscribe, () => store.version);
}

/** Re-render (rAF-batched) only when one session's lane changes. */
export function useLane(store: Store, session: string): Lane | undefined {
  const subscribe = useCallback(
    (onChange: () => void) =>
      rafBatched((fn) =>
        store.subscribe((changed) => {
          if (changed === null || changed === session) fn();
        }),
      )(onChange),
    [store, session],
  );
  useSyncExternalStore(subscribe, () => store.sessions.get(session)?.version ?? 0);
  return store.sessions.get(session);
}

/** Connection/config state (connect status, active relay URL). */
export function useConnectionStatus(controller: Controller): ConnectionStatus {
  const subscribe = useCallback(
    (onChange: () => void) => controller.subscribe(onChange),
    [controller],
  );
  useSyncExternalStore(subscribe, () => controller.version);
  return controller.status;
}
