// Clients for the Connections view's two data sources — both POLLED
// operational state, deliberately outside the event-sourced core store
// (which stays a pure fold over the AEP stream):
//
//   1. each relay's own `/connections` introspection endpoint (read-only,
//      token-gated, an implementation surface of the reference relay — NOT
//      protocol capability discovery; AEP-0004 §4.2's gap is deliberate),
//   2. the reference setup tool's ops API (`aep-setup.js serve`), which
//      wraps the same flows as its CLI verbs. Every action here names the
//      CLI line it mirrors — the programmatic path is the learnable asset.

/** One party on a relay, as the relay's introspection endpoint reports it. */
export interface RelayParty {
  role: string;
  identity: { agent?: string; instance?: string } | null;
  accepts: string[] | null;
  sessions: string[];
  subscriptions: number;
}

export interface RelayIntrospection {
  ok: boolean;
  relay: {
    sessions: number;
    subscribers: number;
    connections: number;
    uptime_s: number;
    control: boolean;
  };
  connections: RelayParty[];
  sse_subscribers: number;
}

/** GET `<relay>/connections` with the browser-friendly query token. */
export async function fetchRelayIntrospection(
  url: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayIntrospection | null> {
  try {
    const base = url.trim().replace(/\/$/, '');
    const res = await fetchImpl(`${base}/connections?access_token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    return (await res.json()) as RelayIntrospection;
  } catch {
    return null;
  }
}

/**
 * One runtime option from the setup tool's per-agent catalog — pure DATA
 * (override key, label, hover help, value type), so the start form renders
 * with zero vendor knowledge in this app. The key is an env var OR an argv
 * flag (`--vendor`) — argv-backed options ride the same env object with the
 * argv string as the key; `optionKey` is the one accessor.
 */
export interface OpsAgentOption {
  env?: string;
  /** Argv-backed options (bridge receivers) carry the flag string instead. */
  argv?: string;
  label: string;
  help: string;
  type: 'flag' | 'string' | 'number';
  default?: string;
  /** Enum — the form renders a dropdown of exactly these. */
  values?: string[];
  /** Free text with a datalist — suggestions, never a constraint. */
  suggestions?: string[];
  /** Mask the input (tokens, keys). */
  secret?: boolean;
}

/** The override key an option rides under — env var name or argv string. */
export function optionKey(o: OpsAgentOption): string {
  return o.env ?? o.argv ?? '';
}

export interface OpsAgent {
  id: string;
  port: number;
  bin: string | null;
  version: string | null;
  minVersion: string | null;
  daemon: { up: boolean; relay: boolean } | null;
  portFree: boolean;
  managed: boolean;
  registered: boolean;
  target: string | null;
  format: string | null;
  note: string | null;
  /** Absent on older serve builds — treat as an empty catalog. */
  options?: OpsAgentOption[];
}

/**
 * One protocol bridge from the setup tool's catalog (SSE/OTLP receivers and
 * the like). Manual bridges (`manual: true`) are registered per project, not
 * daemons here — they carry a note and an empty catalog.
 */
export interface OpsBridge {
  id: string;
  port: number;
  daemon: { up: boolean; relay: boolean } | null;
  portFree?: boolean;
  managed: boolean;
  options: OpsAgentOption[];
  manual?: boolean;
  note?: string;
}

export interface OpsState {
  repo: string;
  relay: {
    url: string;
    up: boolean;
    managed: boolean;
    /** Absent on older serve builds. */
    port?: number;
    /**
     * The shared relay token, so the panel can offer the one-click stream
     * bridge (the ops-token holder already controls this relay's lifecycle).
     */
    token?: string;
    /** Runtime caps catalog — absent on older serve builds. */
    options?: OpsAgentOption[];
  };
  agents: OpsAgent[];
  /** Older serve builds report none — the client degrades to []. */
  bridges: OpsBridge[];
}

export interface OpsRegistration {
  agent: string;
  port: number;
  target: string;
  format: string;
  note: string | null;
  content: string;
}

export interface OpsWriteResult {
  agent: string;
  target: string;
  changed?: boolean;
  added?: number;
  saved?: string;
  manual?: boolean;
  note?: string | null;
}

/**
 * The CLI line each ops action mirrors — shown beside every affordance.
 * Bridge ids ride the same verbs as agents (`up bridge-kilocode-sse`, …);
 * argv-backed overrides ride `--env` with the argv string as the key.
 */
export const CLI = {
  serve: 'node impl/setup/aep-setup.js serve',
  up: (agent: string, env?: Record<string, string>) =>
    `node impl/setup/aep-setup.js up ${agent}${Object.entries(env ?? {})
      .map(([k, v]) => ` --env ${k}=${v}`)
      .join('')}`,
  down: (name: string) => `node impl/setup/aep-setup.js down ${name}`,
  /** The setup CLI has no restart verb — the honest equivalent composes. */
  restart: (name: string, env?: Record<string, string>) =>
    `${CLI.down(name)} && ${CLI.up(name, env)}`,
  write: (agent: string, opts?: { project?: boolean; projectDir?: string }) =>
    `node impl/setup/aep-setup.js write ${agent}${opts?.projectDir
      ? ` --project-dir ${opts.projectDir}`
      : opts?.project ? ' --project' : ''}`,
  print: (agent: string) => `node impl/setup/aep-setup.js print ${agent}`,
  status: 'node impl/setup/aep-setup.js status',
  logs: (name: string) => `tail -n 200 impl/setup/.run/${name}.log`,
};

// The per-agent / per-bridge testing guides live in this repo under
// docs/testing/<id>.md — the catalog id is the guide slug (a documented 1:1
// invariant; the tester index restates it). The canonical shareable location
// is the repo's own blob URL, so a card can deep-link straight to a subject's
// checklist. Base pulled from package.json's repository, default branch main.
export const TESTING_GUIDE_BASE =
  'https://github.com/agenteventprotocol/mission-control/blob/main/docs/testing';
export const guideUrl = (id: string): string => `${TESTING_GUIDE_BASE}/${id}.md`;

export class OpsClient {
  constructor(
    readonly url: string,
    readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: 'GET' | 'POST', pathname: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.url}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`ops ${pathname}: ${res.status}`);
    return (await res.json()) as T;
  }

  async state(): Promise<OpsState> {
    // older serve builds report no bridges — degrade to an empty list
    const s = await this.call<OpsState>('GET', '/api/state');
    return { ...s, bridges: Array.isArray(s.bridges) ? s.bridges : [] };
  }

  print(agent: string, opts?: { project?: boolean; target?: string; projectDir?: string }): Promise<OpsRegistration> {
    const q = new URLSearchParams({ agent });
    if (opts?.project) q.set('project', '1');
    if (opts?.target) q.set('target', opts.target);
    if (opts?.projectDir) q.set('projectDir', opts.projectDir);
    return this.call('GET', `/api/print?${q}`);
  }

  write(agent: string, opts?: { project?: boolean; target?: string; projectDir?: string }): Promise<OpsWriteResult> {
    return this.call('POST', '/api/write', { agent, ...opts });
  }

  /** `agent: 'relay'` starts only the relay; env keys must be in the agent's catalog. */
  up(agent: string, env?: Record<string, string>): Promise<{ ok: boolean; error?: string; already?: boolean; lines: string[] }> {
    return this.call('POST', '/api/up', {
      agent,
      ...(env && Object.keys(env).length ? { env } : {}),
    });
  }

  down(name?: string): Promise<{ stopped: Array<{ name: string; pid: number; stopped: boolean }> }> {
    return this.call('POST', '/api/down', name ? { name } : {});
  }

  /** `name` may be 'relay', an agent, or a bridge id; env re-applies boot options. */
  restart(name: string, env?: Record<string, string>): Promise<{ ok: boolean; error?: string; lines: string[] }> {
    return this.call('POST', '/api/restart', {
      name,
      ...(env && Object.keys(env).length ? { env } : {}),
    });
  }

  logs(name: string, lines = 200): Promise<{ name: string; lines: string[] }> {
    return this.call('GET', `/api/logs?name=${encodeURIComponent(name)}&lines=${lines}`);
  }
}
