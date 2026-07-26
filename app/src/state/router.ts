// Minimal hash router: deep-linkable views without a routing dependency.
//   #/fleet (default, optional ?q= filter seed) · #/inbox · #/events ·
//   #/connections · #/sessions/<session id>
import { useSyncExternalStore } from 'react';

export type Route =
  | { view: 'fleet'; q?: string }
  | { view: 'inbox' }
  | { view: 'events' }
  | { view: 'connections' }
  | { view: 'session'; session: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (path === 'inbox') return { view: 'inbox' };
  if (path === 'events') return { view: 'events' };
  // query-bearing form: the serve connect link (#/connections?ops=…) — the
  // params are ingested at boot (state/config.ts), never part of the route
  if (path === 'connections' || path.startsWith('connections?')) return { view: 'connections' };
  const m = /^sessions\/(.+)$/.exec(path);
  if (m && m[1]) return { view: 'session', session: decodeURIComponent(m[1]) };
  const f = /^fleet\?q=(.+)$/.exec(path);
  if (f && f[1]) return { view: 'fleet', q: decodeURIComponent(f[1]) };
  return { view: 'fleet' };
}

export function routeHash(route: Route): string {
  switch (route.view) {
    case 'fleet':
      return route.q ? `#/fleet?q=${encodeURIComponent(route.q)}` : '#/fleet';
    case 'inbox':
      return '#/inbox';
    case 'events':
      return '#/events';
    case 'connections':
      return '#/connections';
    case 'session':
      return `#/sessions/${encodeURIComponent(route.session)}`;
  }
}

export function navigate(route: Route): void {
  location.hash = routeHash(route);
}

function subscribe(onChange: () => void): () => void {
  addEventListener('hashchange', onChange);
  return () => removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parseHash(hash);
}
