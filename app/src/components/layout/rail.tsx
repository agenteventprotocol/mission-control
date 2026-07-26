// The workspace rail: navigation, and at the foot the connection state,
// relay settings and theme toggle. Attention state is visible here at all
// times (badge on the bell) even when the dock is collapsed.
import { useEffect, useState } from 'react';
import { Radar, LayoutGrid, ListTree, BellRing, BellDot, BellOff, Cable, Moon, Sun, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatusDot } from '@/components/ui/status-dot';
import { useController, useConnectionStatus, useStoreVersion } from '@/state/use-store';
import { useRoute, navigate, type Route } from '@/state/router';
import { loadTheme, applyTheme, type Theme } from '@/state/config';
import { streamErrorHint } from '@/lib/troubleshoot';

const NAV: Array<{ route: Route; label: string; icon: typeof LayoutGrid }> = [
  { route: { view: 'fleet' }, label: 'Fleet', icon: LayoutGrid },
  { route: { view: 'inbox' }, label: 'Attention', icon: BellRing },
  { route: { view: 'events' }, label: 'Live tail', icon: ListTree },
  { route: { view: 'connections' }, label: 'Connections', icon: Cable },
];

/**
 * One dot per configured relay (the aggregate reading is implicit: any
 * non-live dot is visible on its own — a dead relay is never masked by a
 * healthy one). With one relay this renders exactly the pre-multi-relay dot.
 */
function ConnDots() {
  const controller = useController();
  useConnectionStatus(controller);
  const relays = controller.config.relays;
  return (
    <div className="flex flex-col items-center">
      {relays.map((relay) => {
        const url = relay.url.trim().replace(/\/$/, '');
        const status = controller.statuses.get(url) ?? { state: 'idle' as const };
        return (
          <div
            key={url}
            className="flex h-4 w-9 items-center justify-center"
            title={`${status.state}${status.detail ? ` — ${status.detail}` : ''} · ${relay.label ?? url}${
              status.state === 'error' ? ` · ${streamErrorHint(status.detail)}` : ''
            }`}
          >
            <StatusDot state={status.state === 'idle' ? 'off' : status.state} pulse />
            <span className="sr-only">
              {relay.label ?? url}: {status.state}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Rail({
  notifyEnabled,
  onNotifyToggle,
}: {
  notifyEnabled: boolean;
  onNotifyToggle: () => void;
}) {
  const route = useRoute();
  const controller = useController();
  useStoreVersion(controller.store);
  const pending = controller.store.pendingAttention().length;

  const [theme, setTheme] = useState<Theme>(() => loadTheme());
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1 border-r bg-card py-3"
    >
      <a
        href="#/fleet"
        className="mb-2 flex size-9 items-center justify-center rounded-lg text-primary"
        title="AEP Mission Control"
      >
        <Radar className="size-6" aria-hidden />
        <span className="sr-only">AEP Mission Control</span>
      </a>

      {NAV.map(({ route: target, label, icon: Icon }) => {
        const active =
          route.view === target.view || (target.view === 'fleet' && route.view === 'session');
        return (
          <button
            key={target.view}
            type="button"
            title={label}
            aria-label={target.view === 'inbox' && pending > 0 ? `${label} — ${pending} pending` : label}
            aria-current={active ? 'page' : undefined}
            onClick={() => navigate(target)}
            className={cn(
              'relative flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
              active && 'bg-accent text-foreground',
            )}
          >
            <Icon className="size-4.5" aria-hidden />
            {target.view === 'inbox' && pending > 0 && (
              <span className="absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-family-attention px-0.5 text-[9px] font-bold text-white">
                {pending > 9 ? '9+' : pending}
              </span>
            )}
          </button>
        );
      })}

      <div className="mt-auto flex flex-col items-center gap-1">
        <ConnDots />
        <button
          type="button"
          title="Relays & connections — status, topology, and settings"
          aria-label="Relays & connections"
          onClick={() => navigate({ view: 'connections' })}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Settings2 className="size-4.5" aria-hidden />
        </button>
        <button
          type="button"
          title={
            notifyEnabled
              ? 'Desktop notifications: on (hidden tab only) — click to turn off'
              : 'Desktop notifications: off — click to turn on'
          }
          aria-label="Toggle desktop notifications"
          aria-pressed={notifyEnabled}
          onClick={onNotifyToggle}
          className={cn(
            'flex size-9 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-accent hover:text-foreground',
            notifyEnabled ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {notifyEnabled ? <BellDot className="size-4.5" aria-hidden /> : <BellOff className="size-4.5" aria-hidden />}
        </button>
        <button
          type="button"
          title="Toggle theme"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === 'dark' ? <Sun className="size-4.5" aria-hidden /> : <Moon className="size-4.5" aria-hidden />}
        </button>
      </div>
    </nav>
  );
}
