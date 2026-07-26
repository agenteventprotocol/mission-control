// The local-stack section: process posture and actions over the reference
// setup tool's ops API (`aep-setup.js serve`). Honesty rules: only daemons
// the setup tool started (pid files) get Stop/Restart; a daemon found
// healthy on its port without one is "running, not managed here". Every
// action names the CLI line it mirrors — the programmatic path stays the
// learnable asset for anyone building beyond the panel.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Cable, Check, Copy, FileCog, LoaderCircle, Play, RotateCw, ScrollText, Square,
  TerminalSquare, TriangleAlert, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { StatusDot } from '@/components/ui/status-dot';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { loadOpsConfig, saveOpsConfig, loadAgentEnv, saveAgentEnv, type OpsConfig } from '@/state/config';
import { useOptionalController, useConnectionStatus, useStoreVersion } from '@/state/use-store';
import type { Controller } from '@/state/controller';
import { navigate, routeHash } from '@/state/router';
import {
  CLI, OpsClient, optionKey, guideUrl, fetchRelayIntrospection,
  type OpsAgent, type OpsAgentOption, type OpsBridge, type OpsRegistration, type OpsState, type OpsWriteResult,
  type RelayParty,
} from '@/lib/ops';
import { streamErrorHint } from '@/lib/troubleshoot';

const POLL_MS = 5000;

function CliHint({ line }: { line: string }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
      <TerminalSquare className="size-3 shrink-0" aria-hidden />
      <code className="truncate">{line}</code>
      <button
        type="button"
        title="Copy the CLI equivalent"
        aria-label={`Copy: ${line}`}
        className="cursor-pointer opacity-60 hover:opacity-100"
        onClick={() => void navigator.clipboard?.writeText(line)}
      >
        <Copy className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/**
 * A one-hop link to this subject's testing guide (docs/testing/<id>.md in this
 * repo). The catalog id is the guide slug, so every agent and bridge card can
 * point straight at its own checklist — the reading counterpart to CliHint's
 * runnable path. Opens out of the SPA.
 */
function GuideLink({ id }: { id: string }) {
  return (
    <a
      href={guideUrl(id)}
      target="_blank"
      rel="noreferrer"
      title={`Open the ${id} testing guide`}
      className="flex w-fit items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
    >
      <BookOpen className="size-3 shrink-0" aria-hidden />
      testing guide
    </a>
  );
}

/** Shared by agent and bridge cards — both report the same daemon posture. */
function AgentStatusDot({ agent }: {
  agent: { daemon: { up: boolean; relay: boolean } | null; portFree?: boolean; port: number };
}) {
  const up = Boolean(agent.daemon?.up);
  const label = up
    ? agent.daemon!.relay
      ? 'daemon up, relay connected'
      : 'daemon up, relay NOT connected'
    : agent.daemon === null && agent.portFree === false
      ? `port ${agent.port} busy (not our daemon)`
      : 'daemon down';
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title={label}>
      <StatusDot state={up ? (agent.daemon!.relay ? 'live' : 'connecting') : 'off'} />
      {label}
    </span>
  );
}

interface InstancesProps {
  /** The catalog id — the CLASS; instances below carry it. */
  id: string;
  port: number;
  daemon: { up: boolean; relay: boolean } | null;
  managed: boolean;
  /** Every party the relay reports (unfiltered); this block keeps its own. */
  parties?: RelayParty[];
}

/**
 * The class → instances read on a card: the catalog row is the CLASS; the
 * instances are what actually runs — the managed daemon (when up), the
 * sessions this id currently has on Mission Control's event stream, and the
 * live connections the RELAY reports for this id. Two truths, two sources,
 * each labeled: the session count is store-derived (events MC has seen), the
 * parties are relay introspection (GET /connections) — a party can appear
 * before MC sees any event, and vice versa. Renders nothing while nothing
 * runs and the relay reports no party.
 */
function InstancesBlock(props: InstancesProps) {
  const controller = useOptionalController();
  const parties = (props.parties ?? []).filter((p) => p.identity?.agent === props.id);
  if (controller) return <InstancesWithStore {...props} parties={parties} controller={controller} />;
  if (!props.daemon?.up && parties.length === 0) return null;
  return <InstancesList {...props} parties={parties} sessions={0} />;
}

function InstancesWithStore({ controller, ...props }: InstancesProps & { controller: Controller }) {
  useStoreVersion(controller.store);
  let sessions = 0;
  for (const lane of controller.store.sessions.values()) {
    if (lane.agent === props.id && lane.status === 'active') sessions++;
  }
  const parties = props.parties ?? [];
  if (!props.daemon?.up && sessions === 0 && parties.length === 0) return null;
  return <InstancesList {...props} parties={parties} sessions={sessions} />;
}

function InstancesList({ id, port, daemon, managed, sessions, parties = [] }: InstancesProps & { sessions: number }) {
  return (
    <div className="mt-2 space-y-1 border-t border-border pt-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Instances</p>
      {daemon?.up && (
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot state={daemon.relay ? 'live' : 'connecting'} />
          daemon on :{port} · {managed ? 'managed here' : 'not managed here'} ·{' '}
          {daemon.relay ? 'relay connected' : 'relay not connected'}
        </span>
      )}
      {parties.map((p, i) => (
        <span key={i} className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <StatusDot state="live" />
          on the relay{p.identity?.instance ? ` @${p.identity.instance}` : ''}
          {p.role === 'consumer' ? ' · consumer' : ''}
          {(p.accepts ?? []).map((verb) => (
            <span key={verb} className="rounded bg-accent px-1 py-0.5 font-mono text-[10px]">{verb}</span>
          ))}
          {p.sessions.map((s) => (
            <button
              key={s}
              type="button"
              className="cursor-pointer rounded bg-accent px-1 py-0.5 font-mono text-[10px] hover:text-foreground"
              title={`Open session ${s} in Fleet`}
              onClick={() => navigate({ view: 'session', session: s })}
            >
              {s}
            </button>
          ))}
        </span>
      ))}
      {sessions > 0 && (
        <a
          href={routeHash({ view: 'fleet', q: id })}
          className="block text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {sessions} session{sessions === 1 ? '' : 's'} seen on the stream — open in Fleet
        </a>
      )}
    </div>
  );
}

function RegisterDialog({
  agent, client, open, onOpenChange,
}: {
  agent: OpsAgent;
  client: OpsClient;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [reg, setReg] = useState<OpsRegistration | null>(null);
  const [project, setProject] = useState(false);
  const [projectDir, setProjectDir] = useState('');
  const [result, setResult] = useState<OpsWriteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dir = projectDir.trim();
  const opts = { project, ...(dir ? { projectDir: dir } : {}) };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    client.print(agent.id, { project, ...(dir ? { projectDir: dir } : {}) }).then(
      (r) => {
        if (!alive) return;
        setReg(r);
        setResult(null);
        setError(null);
      },
      (e: Error) => {
        if (alive) setError(e.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [open, project, dir, agent.id, client]);

  const apply = () => {
    client.write(agent.id, opts).then(setResult, (e: Error) => setError(e.message));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Register {agent.id}</DialogTitle>
        <DialogDescription>
          Preview first, then apply — the setup tool takes a timestamped backup and re-runs are
          idempotent. The same result by hand: <code>{CLI.write(agent.id)}</code>
        </DialogDescription>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {reg && (
          <div className="space-y-2 text-xs">
            <p>
              <span className="text-muted-foreground">target</span> <code>{reg.target}</code>{' '}
              <Badge variant="outline">{reg.format}</Badge>
            </p>
            {reg.note && <p className="text-muted-foreground">{reg.note}</p>}
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-[11px]">
              {reg.content}
            </pre>
            <label className="flex items-center gap-2">
              <Checkbox checked={project} onCheckedChange={(v) => setProject(v === true)} />
              project-scoped target (where the vendor supports one)
            </label>
            <div>
              <label className="text-[11px] text-muted-foreground" htmlFor={`project-dir-${agent.id}`}>
                Project directory (optional)
              </label>
              <Input
                id={`project-dir-${agent.id}`}
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
                placeholder="absolute path — defaults to the ops server's working directory"
              />
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Project-scoped targets resolve here (implies project scope) — same as{' '}
                <code>--project-dir</code> on the CLI.
              </p>
            </div>
          </div>
        )}
        {result && (
          <p className="text-xs">
            {result.manual
              ? 'This registration is manual on this vendor — use the preview above by hand.'
              : result.changed
                ? `Wrote ${result.target}${result.saved ? ` — backup at ${result.saved}` : ''}`
                : 'Already registered — nothing to change.'}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button variant="ghost">Close</Button>
          </DialogClose>
          <Button aria-label="Apply registration" onClick={apply} disabled={!reg}>
            Apply registration
          </Button>
        </div>
        <CliHint line={CLI.print(agent.id)} />
      </DialogContent>
    </Dialog>
  );
}

/** Touched options → the env override object, keyed by `optionKey`. */
function envFromValues(options: OpsAgentOption[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const o of options) {
    const v = values[optionKey(o)];
    if (v !== undefined && v !== (o.default ?? '')) out[optionKey(o)] = v;
  }
  return out;
}

/**
 * One step of the start scenario, with honest per-step state: `pending`
 * (planned, not reached), `running`, `done`, `failed` (with the reason on
 * the step itself), `manual` (a consent step the tool cannot do). A failed
 * run leaves later steps pending — never silently dropped.
 */
type StepState = 'pending' | 'running' | 'done' | 'failed' | 'manual';
interface ScenarioStep {
  id: string;
  label: string;
  /** The CLI line this step mirrors — the receipt hint stays attached. */
  cli?: string;
  state: StepState;
  detail?: string;
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'running') {
    return <LoaderCircle className="size-3 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />;
  }
  if (state === 'done') return <Check className="size-3 shrink-0" aria-hidden />;
  if (state === 'failed') return <X className="size-3 shrink-0" aria-hidden />;
  if (state === 'manual') return <TriangleAlert className="size-3 shrink-0" aria-hidden />;
  return <StatusDot state="off" className="mx-0.5 size-2" />;
}

function StepList({ steps }: { steps: ScenarioStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1 text-xs" aria-label="Scenario receipt">
      {steps.map((s) => (
        <li key={s.id} data-testid={`step-${s.id}`} data-step-state={s.state} className="flex flex-col gap-0.5">
          <span
            className={cn(
              'flex items-center gap-1.5',
              s.state === 'failed'
                ? 'text-destructive'
                : s.state === 'manual'
                  ? 'text-amber-600 dark:text-amber-400'
                  : s.state === 'pending' && 'text-muted-foreground',
            )}
          >
            <StepIcon state={s.state} />
            <span>
              {s.label}
              {s.detail ? ` — ${s.detail}` : ''}
            </span>
          </span>
          {s.cli && <code className="pl-5 text-[10px] text-muted-foreground">{s.cli}</code>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Option input driven purely by the catalog row — no vendor knowledge here.
 * The row is keyed by `optionKey` (env var or argv string): enum `values`
 * render a dropdown, `suggestions` a datalist (never a constraint), and
 * `secret` masks the input.
 */
function OptionRow({
  option, value, onChange,
}: {
  option: OpsAgentOption;
  value: string | undefined;
  onChange: (next: string) => void;
}) {
  const key = optionKey(option);
  const current = value ?? option.default ?? '';
  const listId = option.suggestions?.length ? `option-list-${key}` : undefined;
  return (
    <div className="flex items-center gap-2 text-xs">
      {option.type === 'flag' ? (
        <Checkbox
          aria-label={key}
          checked={current === '1'}
          onCheckedChange={(v) => onChange(v === true ? '1' : '0')}
        />
      ) : option.values?.length ? (
        <Select value={current} onValueChange={onChange}>
          <SelectTrigger aria-label={key} className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {option.values.map((v) => (
              <SelectItem key={v} value={v}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <>
          <Input
            aria-label={key}
            className="h-7 max-w-40 text-xs"
            type={option.secret ? 'password' : undefined}
            inputMode={option.type === 'number' ? 'numeric' : undefined}
            list={listId}
            value={current}
            onChange={(e) => onChange(e.target.value)}
          />
          {listId && (
            <datalist id={listId}>
              {option.suggestions!.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </>
      )}
      <span>{option.label}</span>
      <code className="text-[10px] text-muted-foreground">{key}</code>
      <span
        role="img"
        aria-label={`help for ${key}`}
        title={option.help}
        className="inline-flex size-4 cursor-help items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground"
      >
        ?
      </span>
    </div>
  );
}

/**
 * The start SCENARIO: registration (when missing), daemon start with
 * catalog-validated runtime options, the Mission Control stream bridge, and
 * Fleet navigation — one click end to end, with a receipt line per executed
 * step naming the CLI/API call it mirrors. The manual path stays visible
 * (and stays the learnable asset); vendor consent steps the tool cannot do
 * are surfaced honestly, never hidden. Bridges ride the same dialog with
 * the steps they actually have: no registration, no vendor note — start
 * with options, then the stream bridge, done.
 */
function StartDialog({
  subject, kind, client, relay, open, onOpenChange, onActed,
}: {
  /** An agent adapter (registration + vendor note) or a protocol bridge (neither). */
  subject: { id: string; options?: OpsAgentOption[]; registered?: boolean; note?: string | null };
  kind: 'agent' | 'bridge';
  client: OpsClient;
  relay: OpsState['relay'] | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onActed: () => void;
}) {
  const controller = useOptionalController();
  const id = subject.id;
  const registered = kind === 'bridge' || Boolean(subject.registered);
  const vendorNote = kind === 'agent' ? (subject.note ?? null) : null;
  const options = useMemo(() => subject.options ?? [], [subject.options]);
  // fresh state per open: the card mounts this dialog only while open
  const [values, setValues] = useState<Record<string, string>>({});
  const [doRegister, setDoRegister] = useState(!registered);
  const [doBridge, setDoBridge] = useState(true);
  const [doFleet, setDoFleet] = useState(kind === 'agent');
  const [steps, setSteps] = useState<ScenarioStep[]>([]);
  const [busy, setBusy] = useState(false);

  const env = useMemo(() => envFromValues(options, values), [values, options]);

  const run = async () => {
    setBusy(true);
    // the PLAN renders up front, every step pending — a failure leaves the
    // unreached steps visibly pending instead of silently dropping them
    const wantRegister = kind === 'agent' && doRegister && !registered;
    const wantStream = (kind === 'bridge' || doBridge) && Boolean(controller && relay?.token);
    const wantFleet = kind === 'agent' && doFleet;
    const plan: ScenarioStep[] = [
      ...(wantRegister
        ? [{ id: 'register', label: `register ${id}`, cli: CLI.write(id), state: 'pending' as StepState }]
        : []),
      { id: 'start', label: `start ${id}`, cli: CLI.up(id, env), state: 'pending' as StepState },
      ...(wantStream
        ? [{ id: 'stream', label: `connect Mission Control's event stream to ${relay!.url}`, state: 'pending' as StepState }]
        : []),
      ...(vendorNote
        ? [{ id: 'vendor', label: `vendor step the tool cannot do for you: ${vendorNote}`, state: 'pending' as StepState }]
        : []),
      ...(wantFleet
        ? [{ id: 'fleet', label: `open Fleet filtered to ${id}`, state: 'pending' as StepState }]
        : []),
    ];
    const sync = () => setSteps(plan.map((s) => ({ ...s })));
    const mark = (stepId: string, patch: Partial<ScenarioStep>) => {
      Object.assign(plan.find((s) => s.id === stepId)!, patch);
      sync();
    };
    sync();
    try {
      if (wantRegister) {
        mark('register', { state: 'running' });
        try {
          const w = await client.write(id, {});
          mark('register', w.manual
            ? { state: 'manual', detail: 'manual on this vendor — use Config for the exact content' }
            : { state: 'done', detail: w.changed ? `wrote ${w.target ?? 'the vendor config'}` : 'already registered' });
        } catch (e) {
          mark('register', { state: 'failed', detail: (e as Error).message });
          return;
        }
      }
      mark('start', { state: 'running' });
      let upOk = false;
      try {
        const r = await client.up(id, env);
        upOk = r.ok !== false;
        // remember how this daemon was booted so Restart can re-apply it
        if (upOk) saveAgentEnv(id, env);
        mark('start', upOk ? { state: 'done' } : { state: 'failed', detail: r.error });
      } catch (e) {
        mark('start', { state: 'failed', detail: (e as Error).message });
      }
      if (!upOk) return;
      if (wantStream && controller && relay?.token) {
        mark('stream', { state: 'running' });
        const entry = controller.config.relays.find((r) => r.url === relay.url);
        if (!entry || entry.token !== relay.token) {
          const next = entry
            ? controller.config.relays.map((r) => (r.url === relay.url ? { ...r, token: relay.token! } : r))
            : [...controller.config.relays, { url: relay.url, token: relay.token, label: 'local relay' }];
          controller.connect(next);
          mark('stream', { state: 'done', detail: 'the same connection the status dot reports' });
        } else {
          mark('stream', { state: 'done', detail: 'already configured for this relay' });
        }
      }
      if (vendorNote) mark('vendor', { state: 'manual' });
      // the fleet step runs only on an all-green scenario: a failed or
      // manual step keeps the operator here, where the state is visible
      if (wantFleet && plan.every((s) => s.state === 'done' || s.id === 'fleet')) {
        mark('fleet', { state: 'done' });
        onOpenChange(false);
        navigate({ view: 'fleet', q: id });
      }
    } finally {
      setBusy(false);
      onActed();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Start {id}</DialogTitle>
        <DialogDescription>
          Runs the whole scenario from here — no terminal needed. Every step below shows the CLI
          line it mirrors, so the programmatic path stays learnable.
        </DialogDescription>
        {options.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-muted-foreground">Runtime options (hover ? for help)</p>
            {options.map((o) => (
              <OptionRow
                key={optionKey(o)}
                option={o}
                value={values[optionKey(o)]}
                onChange={(next) => setValues((v) => ({ ...v, [optionKey(o)]: next }))}
              />
            ))}
          </div>
        )}
        <div className="space-y-1.5 text-xs">
          {kind === 'agent' && !registered && (
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Apply the vendor registration first"
                checked={doRegister}
                onCheckedChange={(v) => setDoRegister(v === true)}
              />
              Apply the vendor registration first ({CLI.write(id)})
            </label>
          )}
          {kind === 'agent' ? (
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Connect Mission Control's event stream to the relay"
                checked={doBridge}
                onCheckedChange={(v) => setDoBridge(v === true)}
              />
              Connect Mission Control&rsquo;s event stream to the relay (drives the status dot)
            </label>
          ) : (
            <p className="text-muted-foreground">
              Bridges have no vendor registration — start with options, and the Mission Control
              stream bridge follows automatically.
            </p>
          )}
          {kind === 'agent' && (
            <label className="flex items-center gap-2">
              <Checkbox
                aria-label="Open Fleet filtered to this agent"
                checked={doFleet}
                onCheckedChange={(v) => setDoFleet(v === true)}
              />
              Open Fleet filtered to this agent when everything is green
            </label>
          )}
        </div>
        <StepList steps={steps} />
        <div className="flex items-center justify-between gap-2 pt-2">
          <CliHint line={CLI.up(id, env)} />
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
            <Button aria-label="Run start scenario" disabled={busy} onClick={() => void run()}>
              <Play className="size-3.5" aria-hidden /> Start
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LogsDialog({
  name, client, open, onOpenChange,
}: {
  name: string;
  client: OpsClient;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    client.logs(name).then((r) => { setLines(r.lines); setError(null); }, (e: Error) => setError(e.message));
  }, [client, name]);
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{name} — process log</DialogTitle>
        <DialogDescription>
          The setup tool&rsquo;s stdout/stderr capture for daemons it started. Durable per-session
          event logs live under <code>~/.aep/logs/</code>.
        </DialogDescription>
        {error && <p className="text-xs text-destructive">{error} (only daemons started by the setup tool have a log here)</p>}
        {lines && (
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
            {lines.join('\n') || '(empty)'}
          </pre>
        )}
        <div className="flex items-center justify-between pt-2">
          <CliHint line={CLI.logs(name)} />
          <div className="flex gap-2">
            <Button variant="ghost" onClick={refresh}>Refresh</Button>
            <DialogClose asChild>
              <Button variant="ghost">Close</Button>
            </DialogClose>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Progressive form shown beside the status dot while an action is in flight. */
const BUSY_VERB: Record<string, string> = { start: 'starting…', stop: 'stopping…', restart: 'restarting…' };

/**
 * The card action wrapper both card kinds share: one action in flight at a
 * time, the in-flight verb named beside the status dot, failures surfaced
 * as the card note, and a state refresh the moment the action returns —
 * never waiting out the 5s poll.
 */
function useOpsAction(onActed: () => void) {
  const [busyVerb, setBusyVerb] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const act = (label: string, fn: () => Promise<unknown>) => {
    setBusyVerb(BUSY_VERB[label] ?? `${label}…`);
    setNote(null);
    fn().then(
      (r) => {
        const failed = typeof r === 'object' && r !== null && (r as { ok?: boolean }).ok === false;
        setNote(failed ? ((r as { error?: string }).error ?? `${label} failed`) : null);
        setBusyVerb(null);
        onActed();
      },
      (e: Error) => {
        setNote(e.message);
        setBusyVerb(null);
      },
    );
  };
  return { busy: busyVerb !== null, busyVerb, note, act };
}

function ProcessCard({
  agent, client, relay, onActed, parties,
}: {
  agent: OpsAgent;
  client: OpsClient;
  relay: OpsState['relay'] | null;
  onActed: () => void;
  parties?: RelayParty[];
}) {
  const { busy, busyVerb, note, act } = useOpsAction(onActed);
  const [configOpen, setConfigOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  const running = agent.daemon !== null;
  // the options this panel last started the agent with (empty when the
  // daemon was never panel-started); Restart re-applies them
  const rememberedEnv = loadAgentEnv(agent.id);
  return (
    <div data-testid={`process-${agent.id}`} className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{agent.id}</span>
        <span className="font-mono text-[10px] text-muted-foreground">:{agent.port}</span>
        {agent.registered && <Badge variant="outline">registered</Badge>}
        {running && !agent.managed && (
          <Badge variant="outline" title="Healthy on its port, but not started by the setup tool — stop it where you started it.">
            not managed here
          </Badge>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <AgentStatusDot agent={agent} />
          {busyVerb && <span className="text-[11px] text-muted-foreground">{busyVerb}</span>}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">
          {agent.bin ? (agent.version ?? agent.bin) : 'CLI not found'}
          {agent.minVersion ? ` (min ${agent.minVersion})` : ''}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!running && (
          <Button
            size="sm" variant="outline" disabled={busy}
            aria-label={`Start ${agent.id}`}
            title={CLI.up(agent.id)}
            onClick={() => setStartOpen(true)}
          >
            <Play className="size-3.5" aria-hidden /> Start
          </Button>
        )}
        {running && agent.managed && (
          <>
            <Button
              size="sm" variant="outline" disabled={busy}
              aria-label={`Stop ${agent.id}`}
              title={CLI.down(agent.id)}
              onClick={() => act('stop', () => client.down(agent.id))}
            >
              <Square className="size-3.5" aria-hidden /> Stop
            </Button>
            <Button
              size="sm" variant="outline" disabled={busy}
              aria-label={`Restart ${agent.id}`}
              title={Object.keys(rememberedEnv).length
                ? `${CLI.restart(agent.id, rememberedEnv)} — re-applies your last start options (a rebooted daemon keeps only its boot-time env)`
                : CLI.restart(agent.id)}
              onClick={() => (Object.keys(rememberedEnv).length
                ? act('restart', async () => {
                    await client.down(agent.id);
                    return client.up(agent.id, rememberedEnv);
                  })
                : act('restart', () => client.restart(agent.id)))}
            >
              <RotateCw className="size-3.5" aria-hidden /> Restart
            </Button>
          </>
        )}
        <Button
          size="sm" variant="ghost" disabled={busy}
          aria-label={`Configure ${agent.id}`}
          title={CLI.print(agent.id)}
          onClick={() => setConfigOpen(true)}
        >
          <FileCog className="size-3.5" aria-hidden /> Config
        </Button>
        {agent.managed && (
          <Button
            size="sm" variant="ghost"
            aria-label={`Logs ${agent.id}`}
            title={CLI.logs(agent.id)}
            onClick={() => setLogsOpen(true)}
          >
            <ScrollText className="size-3.5" aria-hidden /> Logs
          </Button>
        )}
      </div>
      {note && <p className="mt-1 text-[11px] text-destructive">{note}</p>}
      <div className="mt-2 flex flex-col gap-1">
        <CliHint line={running ? CLI.down(agent.id) : CLI.up(agent.id)} />
        <GuideLink id={agent.id} />
      </div>
      <InstancesBlock id={agent.id} port={agent.port} daemon={agent.daemon} managed={agent.managed} parties={parties} />
      <RegisterDialog agent={agent} client={client} open={configOpen} onOpenChange={setConfigOpen} />
      <LogsDialog name={agent.id} client={client} open={logsOpen} onOpenChange={setLogsOpen} />
      {startOpen && (
        <StartDialog
          subject={agent} kind="agent" client={client} relay={relay}
          open onOpenChange={setStartOpen} onActed={onActed}
        />
      )}
    </div>
  );
}

/**
 * One protocol bridge from the ops catalog — the same card family as
 * ProcessCard (bridge ids ride the same daemon verbs on the ops API), minus
 * the vendor registration: bridges have none. A manual bridge (bridge-acp)
 * is not a daemon here — the server refuses starting it — so its card is
 * info-only: the note and where to read on.
 */
function BridgeCard({
  bridge, client, relay, onActed, parties,
}: {
  bridge: OpsBridge;
  client: OpsClient;
  relay: OpsState['relay'] | null;
  onActed: () => void;
  parties?: RelayParty[];
}) {
  const { busy, busyVerb, note, act } = useOpsAction(onActed);
  const [logsOpen, setLogsOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  if (bridge.manual) {
    return (
      <div data-testid={`process-${bridge.id}`} className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{bridge.id}</span>
          <Badge variant="outline">manual</Badge>
        </div>
        {bridge.note && <p className="mt-1 text-[11px] text-muted-foreground">{bridge.note}</p>}
        <p className="mt-1 text-[10px] text-muted-foreground">
          not a daemon the setup tool starts — see <code>impl/{bridge.id}/README.md</code> in the
          reference checkout
        </p>
        <div className="mt-1">
          <GuideLink id={bridge.id} />
        </div>
      </div>
    );
  }

  const running = bridge.daemon !== null;
  // the options this panel last started the bridge with; Restart re-applies
  // them (the persistence is id-keyed, shared with agents)
  const rememberedEnv = loadAgentEnv(bridge.id);
  return (
    <div data-testid={`process-${bridge.id}`} className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{bridge.id}</span>
        <span className="font-mono text-[10px] text-muted-foreground">:{bridge.port}</span>
        {running && (
          bridge.managed
            ? <Badge variant="outline" title="Started by the setup tool — Stop/Restart act here.">managed here</Badge>
            : (
              <Badge variant="outline" title="Healthy on its port, but not started by the setup tool — stop it where you started it.">
                not managed here
              </Badge>
            )
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <AgentStatusDot agent={bridge} />
        {busyVerb && <span className="text-[11px] text-muted-foreground">{busyVerb}</span>}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {!running && (
          <Button
            size="sm" variant="outline" disabled={busy}
            aria-label={`Start ${bridge.id}`}
            title={CLI.up(bridge.id)}
            onClick={() => setStartOpen(true)}
          >
            <Play className="size-3.5" aria-hidden /> Start
          </Button>
        )}
        {running && bridge.managed && (
          <>
            <Button
              size="sm" variant="outline" disabled={busy}
              aria-label={`Stop ${bridge.id}`}
              title={CLI.down(bridge.id)}
              onClick={() => act('stop', () => client.down(bridge.id))}
            >
              <Square className="size-3.5" aria-hidden /> Stop
            </Button>
            <Button
              size="sm" variant="outline" disabled={busy}
              aria-label={`Restart ${bridge.id}`}
              title={Object.keys(rememberedEnv).length
                ? `${CLI.restart(bridge.id, rememberedEnv)} — re-applies your last start options (a rebooted daemon keeps only its boot-time env)`
                : CLI.restart(bridge.id)}
              onClick={() => (Object.keys(rememberedEnv).length
                ? act('restart', async () => {
                    await client.down(bridge.id);
                    return client.up(bridge.id, rememberedEnv);
                  })
                : act('restart', () => client.restart(bridge.id)))}
            >
              <RotateCw className="size-3.5" aria-hidden /> Restart
            </Button>
          </>
        )}
        {bridge.managed && (
          <Button
            size="sm" variant="ghost"
            aria-label={`Logs ${bridge.id}`}
            title={CLI.logs(bridge.id)}
            onClick={() => setLogsOpen(true)}
          >
            <ScrollText className="size-3.5" aria-hidden /> Logs
          </Button>
        )}
      </div>
      {note && <p className="mt-1 text-[11px] text-destructive">{note}</p>}
      <div className="mt-2 flex flex-col gap-1">
        <CliHint line={running ? CLI.down(bridge.id) : CLI.up(bridge.id)} />
        <GuideLink id={bridge.id} />
      </div>
      <InstancesBlock id={bridge.id} port={bridge.port} daemon={bridge.daemon} managed={bridge.managed} parties={parties} />
      <LogsDialog name={bridge.id} client={client} open={logsOpen} onOpenChange={setLogsOpen} />
      {startOpen && (
        <StartDialog
          subject={bridge} kind="bridge" client={client} relay={relay}
          open onOpenChange={setStartOpen} onActed={onActed}
        />
      )}
    </div>
  );
}

/**
 * The stream bridge, automatic: connecting the ops endpoint IS the consent
 * to mirror its stack — the ops token already starts and stops this relay,
 * so its stream token is adopted without a second decision. The adoption is
 * a visible receipt, never a silent write, and the row then shows the SAME
 * stream state the rail status dot reports — panel truth and rail truth
 * stay one fact.
 */
function OpsRelayBridge({ relay }: { relay: OpsState['relay'] }) {
  const controller = useOptionalController();
  if (!controller || !relay.token) return null;
  return <OpsRelayBridgeInner relay={relay} controller={controller} />;
}

// Adoption receipts for this page load: which relay URLs the bridge synced.
// Module scope (not state, not a ref) — render derives from it, the effect
// writes it, and a reload honestly forgets receipts for work it did not do.
const adoptedThisSession = new Set<string>();

function OpsRelayBridgeInner({ relay, controller }: { relay: OpsState['relay']; controller: Controller }) {
  useConnectionStatus(controller);
  const entry = controller.config.relays.find((r) => r.url === relay.url);
  const bridged = Boolean(entry && entry.token === relay.token);

  useEffect(() => {
    if (bridged || !relay.token) return;
    const current = controller.config.relays;
    const existing = current.find((r) => r.url === relay.url);
    const next = existing
      ? current.map((r) => (r.url === relay.url ? { ...r, token: relay.token! } : r))
      : [...current, { url: relay.url, token: relay.token, label: 'local relay' }];
    adoptedThisSession.add(relay.url);
    controller.connect(next);
  }, [bridged, relay.url, relay.token, controller]);

  if (!bridged) return null; // adoption is in flight; the next notify renders the state
  const status = controller.statuses.get(relay.url);
  const state = status?.state ?? 'idle';
  return (
    <span className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <span className="flex flex-wrap items-center gap-1.5">
        <StatusDot state={state === 'idle' ? 'off' : state} />
        Mission Control stream: {state === 'idle' ? 'not connected' : state}
        {state === 'error' && status?.detail && (
          <span className="text-destructive">({status.detail})</span>
        )}
        {adoptedThisSession.has(relay.url) && (
          <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
            <Cable className="size-3" aria-hidden /> adopted from the local stack — stream token synced
          </span>
        )}
      </span>
      {state === 'error' && (
        // this row only renders while the ops state says the relay is up —
        // the hint must reconcile that vantage with the browser's failure,
        // visibly (a tooltip is not a troubleshooting surface)
        <span className="text-[11px]">{streamErrorHint(status?.detail, { stackReportsUp: true })}</span>
      )}
    </span>
  );
}

export function OpsPanel({ onState }: {
  onState?: (state: OpsState | null, endpoint?: { url: string; reachable: boolean }) => void;
}) {
  const [config, setConfig] = useState<OpsConfig>(() => loadOpsConfig());
  const [draft, setDraft] = useState<OpsConfig>(config);
  const [state, setState] = useState<OpsState | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  // the parties the managed relay reports (GET /connections) — polled here
  // once and handed to every card, so a class card shows its live relay
  // connection beside the store-derived session count
  const [parties, setParties] = useState<RelayParty[]>([]);
  const [relayLogsOpen, setRelayLogsOpen] = useState(false);
  const [relayOptsOpen, setRelayOptsOpen] = useState(false);
  // the caps this panel last started the relay with (persisted like agent
  // env); the form starts from them, so Restart re-applies them — a
  // rebooted relay keeps only its boot-time env
  const [relayValues, setRelayValues] = useState<Record<string, string>>(() => loadAgentEnv('relay'));
  const client = useMemo(() => new OpsClient(config.url, config.token), [config]);

  // polls overlap when the server answers slowly — an older in-flight
  // response resolving after a newer one must never clobber it
  const stateSeq = useRef(0);
  const refresh = useCallback(() => {
    const seq = ++stateSeq.current;
    client.state().then(
      (s) => {
        if (seq !== stateSeq.current) return;
        setState(s); setReachable(true); onState?.(s, { url: config.url, reachable: true });
      },
      () => {
        if (seq !== stateSeq.current) return;
        setState(null); setReachable(false); onState?.(null, { url: config.url, reachable: false });
      },
    );
  }, [client, config.url, onState]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // poll the managed relay's introspection so cards can show their live
  // relay connection; only when the relay is up and a token is known
  const relayUrl = state?.relay.up ? state.relay.url : null;
  const relayToken = state?.relay.token ?? null;
  useEffect(() => {
    if (!relayUrl || !relayToken) return;
    let alive = true;
    let seq = 0; // overlapping ticks: only the newest result may land
    const tick = async () => {
      const mine = ++seq;
      const intro = await fetchRelayIntrospection(relayUrl, relayToken);
      if (alive && mine === seq) setParties(intro?.connections ?? []);
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [relayUrl, relayToken]);
  // while the relay is down/unknown, mask any stale poll result
  const shownParties = relayUrl && relayToken ? parties : [];

  // the serve connect link, ingested while this panel is already mounted
  useEffect(() => {
    const reload = () => {
      const next = loadOpsConfig();
      setConfig(next);
      setDraft(next);
    };
    addEventListener('aep-mc:ops-config', reload);
    return () => removeEventListener('aep-mc:ops-config', reload);
  }, []);

  const saveDraft = () => {
    const next = { url: draft.url.trim().replace(/\/$/, ''), token: draft.token };
    saveOpsConfig(next);
    setConfig(next);
  };

  const relayOptions = state?.relay.options ?? [];
  const relayEnv = envFromValues(relayOptions, relayValues);
  /** Start/Restart share it: on success the sent caps become the remembered boot env. */
  const relayAct = (fn: () => Promise<{ ok: boolean }>) => {
    fn().then(
      (r) => {
        if (r.ok !== false) saveAgentEnv('relay', relayEnv);
        refresh();
      },
      refresh,
    );
  };

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label className="text-[11px] text-muted-foreground" htmlFor="ops-url">Ops endpoint</label>
          <Input
            id="ops-url"
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            placeholder="http://127.0.0.1:8799"
          />
        </div>
        <div className="min-w-44">
          <label className="text-[11px] text-muted-foreground" htmlFor="ops-token">Token</label>
          <Input
            id="ops-token"
            type="password"
            value={draft.token}
            onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
            placeholder="printed by `serve`"
            autoComplete="off"
          />
        </div>
        <Button variant="outline" onClick={saveDraft}>Connect</Button>
      </header>

      {reachable === false && (
        <div className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">No ops API at {config.url}.</p>
          <p className="mt-1">
            The local-stack actions ride the reference setup tool. In your reference checkout, run:
          </p>
          <pre className="mt-2 rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px]">
            node impl/setup/aep-setup.js serve
          </pre>
          <p className="mt-2">
            It prints a <span className="font-medium text-foreground">connect link</span> — open it
            and this panel configures itself, no copying. (The URL and token it also prints can be
            pasted above instead.) It binds to loopback and every request needs the token.
            Everything the panel does is also a CLI verb —{' '}
            <code>detect · print · write · up · status · down</code> — so the panel is the smooth
            path, never the only path.
          </p>
        </div>
      )}

      {state && (
        <>
          <Tabs defaultValue="adapters" className="space-y-3">
            <TabsList>
              <TabsTrigger value="adapters">Adapters</TabsTrigger>
              <TabsTrigger value="bridges">Bridges</TabsTrigger>
              <TabsTrigger value="relay">Relay</TabsTrigger>
            </TabsList>
            <TabsContent value="adapters">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {state.agents.map((agent) => (
                  <ProcessCard key={agent.id} agent={agent} client={client} relay={state.relay} onActed={refresh} parties={shownParties} />
                ))}
              </div>
            </TabsContent>
            <TabsContent value="bridges">
              {state.bridges.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  No protocol bridges reported — older serve builds predate the bridge catalog.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {state.bridges.map((bridge) => (
                    <BridgeCard key={bridge.id} bridge={bridge} client={client} relay={state.relay} onActed={refresh} parties={shownParties} />
                  ))}
                </div>
              )}
            </TabsContent>
            {/* forceMount: the zero-click stream-token adoption (OpsRelayBridge)
                is an effect of the relay row — it must stay mounted while
                another tab is active, or "automatic" would mean "after a
                click". Radix hides the inactive panel with the hidden attr. */}
            <TabsContent value="relay" forceMount>
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-xs">
            <span className="font-semibold">relay</span>
            <span className="font-mono text-[10px] text-muted-foreground">{state.relay.url}</span>
            <StatusDot state={state.relay.up ? 'live' : 'off'} />
            <span className="text-muted-foreground">{state.relay.up ? 'up' : 'down'}</span>
            {state.relay.up && !state.relay.managed && <Badge variant="outline">not managed here</Badge>}
            {state.relay.up && <OpsRelayBridge relay={state.relay} />}
            <span className="ml-auto flex gap-1.5">
              {!state.relay.up && (
                <Button
                  size="sm" variant="outline"
                  aria-label="Start relay"
                  title={CLI.up('relay', relayEnv)}
                  onClick={() => relayAct(() => client.up('relay', relayEnv))}
                >
                  <Play className="size-3.5" aria-hidden /> Start relay
                </Button>
              )}
              {state.relay.managed && (
                <>
                  <Button
                    size="sm" variant="outline" aria-label="Restart relay"
                    title={`${CLI.restart('relay', relayEnv)} — re-applies your last start options (a rebooted relay keeps only its boot-time env)`}
                    onClick={() => relayAct(() => client.restart('relay', relayEnv))}
                  >
                    <RotateCw className="size-3.5" aria-hidden /> Restart
                  </Button>
                  <Button size="sm" variant="outline" aria-label="Stop relay" title={CLI.down('relay')} onClick={() => client.down('relay').then(refresh, refresh)}>
                    <Square className="size-3.5" aria-hidden /> Stop
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Logs relay" onClick={() => setRelayLogsOpen(true)}>
                    <ScrollText className="size-3.5" aria-hidden /> Logs
                  </Button>
                </>
              )}
              {relayOptions.length > 0 && (!state.relay.up || state.relay.managed) && (
                <Button
                  size="sm" variant="ghost"
                  aria-label="Relay options"
                  aria-expanded={relayOptsOpen}
                  title="Runtime caps — sent as env on Start/Restart"
                  onClick={() => setRelayOptsOpen((v) => !v)}
                >
                  <FileCog className="size-3.5" aria-hidden /> Options
                </Button>
              )}
            </span>
            {relayOptsOpen && relayOptions.length > 0 && (
              <div className="w-full space-y-1.5 border-t border-border pt-2">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Runtime options (hover ? for help) — sent as env on Start/Restart
                </p>
                {relayOptions.map((o) => (
                  <OptionRow
                    key={optionKey(o)}
                    option={o}
                    value={relayValues[optionKey(o)]}
                    onChange={(next) => setRelayValues((v) => ({ ...v, [optionKey(o)]: next }))}
                  />
                ))}
              </div>
            )}
              </div>
              <LogsDialog name="relay" client={client} open={relayLogsOpen} onOpenChange={setRelayLogsOpen} />
            </TabsContent>
          </Tabs>
          <p className="text-[11px] text-muted-foreground">
            repo <code>{state.repo}</code> · the ops API wraps the setup tool&rsquo;s own verbs —{' '}
            <code>{CLI.status}</code> shows the same posture in a terminal.
          </p>
        </>
      )}
    </section>
  );
}
