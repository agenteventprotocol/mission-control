// Browser-side persistence: relay config, resume positions, theme. All keyed
// in localStorage; corrupted entries degrade to defaults (a cold start).
import type { PositionStore } from '../core/connection.js';

export interface RelayEntry {
  url: string;
  token: string;
  /** Presentation only — changing it never re-keys anything. */
  label?: string;
}

/** The configured relay set (the multi-relay model: ARCHITECTURE.md §4). */
export interface RelayConfig {
  relays: RelayEntry[];
}

export const DEFAULT_RELAY_URL = 'http://127.0.0.1:8787';

const CONFIG_KEY = 'aep-mc:config';

/**
 * The local ops API (the reference setup tool's `serve` verb) driving the
 * Connections view's local-stack section. Distinct from the relay entries by
 * design: an ops endpoint guards a machine, a relay guards a stream — the
 * multi-relay model keeps their tokens uncoupled.
 */
export interface OpsConfig {
  url: string;
  token: string;
}

export const DEFAULT_OPS_URL = 'http://127.0.0.1:8799';

const OPS_KEY = 'aep-mc:ops';

export function loadOpsConfig(storage: ConfigStorage = defaultStorage()): OpsConfig {
  try {
    const raw = storage.getItem(OPS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const src = parsed as Record<string, unknown>;
        return {
          url: typeof src.url === 'string' && src.url ? src.url.trim().replace(/\/$/, '') : DEFAULT_OPS_URL,
          token: typeof src.token === 'string' ? src.token : '',
        };
      }
    }
  } catch {
    /* corrupted → defaults */
  }
  return { url: DEFAULT_OPS_URL, token: '' };
}

export function saveOpsConfig(config: OpsConfig, storage: ConfigStorage = defaultStorage()): void {
  storage.setItem(OPS_KEY, JSON.stringify(config));
}

/**
 * The runtime options each agent was last started with FROM THIS PANEL
 * (catalog env only — the serve API validates against the catalog anyway).
 * Restart re-applies them: a rebooted daemon keeps only its boot-time env,
 * so a restart that sent nothing would silently un-flag a daemon started
 * with, say, the steering toggle on.
 */
const AGENT_ENV_KEY = 'aep-mc:agent-env';

export function loadAgentEnv(agentId: string, storage: ConfigStorage = defaultStorage()): Record<string, string> {
  try {
    const raw = storage.getItem(AGENT_ENV_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const entry = (parsed as Record<string, unknown>)[agentId];
        if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(entry as Record<string, unknown>)) {
            if (typeof v === 'string') out[k] = v;
          }
          return out;
        }
      }
    }
  } catch {
    /* corrupted → empty */
  }
  return {};
}

export function saveAgentEnv(agentId: string, env: Record<string, string>, storage: ConfigStorage = defaultStorage()): void {
  let all: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(AGENT_ENV_KEY) ?? '{}');
    if (typeof parsed === 'object' && parsed !== null) all = parsed as Record<string, unknown>;
  } catch {
    /* corrupted → rebuild */
  }
  all[agentId] = env;
  storage.setItem(AGENT_ENV_KEY, JSON.stringify(all));
}

/**
 * The serve connect link (zero-paste onboarding): `aep-setup serve` prints
 * `#/connections?ops=<url>&opsToken=<t>` — credentials in the hash fragment,
 * which a browser never sends over the network. Parse it here; the caller
 * saves the config and strips the secret from the address bar. Returns null
 * for anything that is not a complete, well-formed connect link.
 */
export function ingestOpsConnectHash(hash: string): OpsConfig | null {
  const m = /^#\/?connections\?(.+)$/.exec(hash);
  if (!m || !m[1]) return null;
  const params = new URLSearchParams(m[1]);
  const ops = params.get('ops');
  const token = params.get('opsToken');
  if (!ops || !token) return null;
  try {
    const parsed = new URL(ops);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  return { url: ops.trim().replace(/\/$/, ''), token };
}

/** Injectable storage (jsdom ships no localStorage; the saved-filters seam). */
export type ConfigStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): ConfigStorage {
  if (typeof localStorage !== 'undefined') return localStorage;
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}
const THEME_KEY = 'aep-mc:theme';
const NOTIFY_KEY = 'aep-mc:notify';

/** Desktop-notification opt-in (default OFF; flipped only by the toggle). */
export function loadNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveNotifyEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(NOTIFY_KEY, enabled ? '1' : '0');
  } catch {
    /* non-persistent is fine */
  }
}

function sanitizeEntry(raw: unknown): RelayEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const src = raw as Record<string, unknown>;
  if (typeof src.url !== 'string' || !src.url) return null;
  const entry: RelayEntry = {
    url: src.url.trim().replace(/\/$/, ''),
    token: typeof src.token === 'string' ? src.token : '',
  };
  if (typeof src.label === 'string' && src.label) entry.label = src.label;
  return entry;
}

/**
 * Load the relay set: corrupted, empty, or unrecognized storage degrades
 * to the built-in default relay.
 */
export function loadConfig(storage: ConfigStorage = defaultStorage()): RelayConfig {
  try {
    const raw = storage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const candidates = Array.isArray((parsed as { relays?: unknown }).relays)
        ? ((parsed as { relays: unknown[] }).relays)
        : [];
      const relays = candidates
        .map(sanitizeEntry)
        .filter((e): e is RelayEntry => e !== null);
      if (relays.length > 0) return { relays };
    }
  } catch {
    /* corrupted → defaults */
  }
  return { relays: [{ url: DEFAULT_RELAY_URL, token: '' }] };
}

export function saveConfig(config: RelayConfig, storage: ConfigStorage = defaultStorage()): void {
  storage.setItem(CONFIG_KEY, JSON.stringify(config));
}

/**
 * Cap on the persisted known-session set, matched to the reference relay's
 * default session buffer (AEP_MAX_SESSIONS = 500): positions beyond what any
 * relay still holds replay nothing anywhere. Unbounded accumulation once
 * grew the set until the stream request itself was refused — persisted
 * state that only grows crosses invisible limits.
 */
const MAX_POSITIONS = 500;

/** Resume positions per relay URL: the persisted known-session set. */
export function positionStore(url: string, storage: ConfigStorage = defaultStorage()): PositionStore {
  const key = `aep-mc:positions:${url}`;
  return {
    load() {
      try {
        const raw = storage.getItem(key);
        if (raw) return JSON.parse(raw);
      } catch {
        /* corrupted → cold start */
      }
      return [];
    },
    save(positions) {
      storage.setItem(key, JSON.stringify(positions.slice(-MAX_POSITIONS)));
    },
  };
}

export type Theme = 'light' | 'dark';

export function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* fall through */
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* non-persistent is fine */
  }
}
