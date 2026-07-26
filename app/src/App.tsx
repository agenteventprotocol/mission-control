import { useEffect, useMemo, useRef, useState } from 'react';
import { Controller } from './state/controller';
import { ControllerContext, useStoreVersion } from './state/use-store';
import { UiContext, type UiActions } from './state/ui';
import { useRoute } from './state/router';
import { loadNotifyEnabled, saveNotifyEnabled, ingestOpsConnectHash, saveOpsConfig } from './state/config';
import { shouldNotify, notificationContent, type NotifyPermission } from './lib/notify';
import { EventHoverProvider } from './components/event/event-hover';
import { Rail } from './components/layout/rail';
import { AttentionDock } from './components/layout/attention-dock';
import { FleetView } from './views/fleet/fleet-view';
import { InboxView } from './views/inbox/inbox-view';
import { EventsView } from './views/events/events-view';
import { SessionView } from './views/session/session-view';
import { ConnectionsView } from './views/connections/connections-view';

function View() {
  const route = useRoute();
  switch (route.view) {
    case 'inbox':
      return <InboxView />;
    case 'events':
      return <EventsView />;
    case 'connections':
      return <ConnectionsView />;
    case 'session':
      return <SessionView session={route.session} />;
    default:
      return <FleetView />;
  }
}

const notifyPermission = (): NotifyPermission =>
  typeof Notification === 'undefined' ? 'denied' : Notification.permission;

/**
 * Attention presence, made ambient: tab-title badge + dock auto-open, and —
 * behind the explicit opt-in toggle — one desktop notification per new
 * pending request while the tab is hidden (decision matrix in lib/notify;
 * clicking it focuses the window and opens the dock). Exported by name for
 * the component tests; only App mounts it.
 */
export function AttentionPresence({
  controller,
  notifyEnabled,
  onNewRequest,
}: {
  controller: Controller;
  notifyEnabled: boolean;
  onNewRequest: () => void;
}) {
  useStoreVersion(controller.store);
  const pending = controller.store.pendingAttention();
  const known = useRef<Set<string>>(new Set());
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    document.title = pending.length ? `(${pending.length}) AEP Mission Control` : 'AEP Mission Control';
  }, [pending.length]);

  useEffect(() => {
    let hasNew = false;
    const next = new Set<string>();
    const ctx = {
      enabled: notifyEnabled,
      permission: notifyPermission(),
      hidden: document.hidden,
    };
    for (const item of pending) {
      next.add(item.request.id);
      if (!known.current.has(item.request.id)) hasNew = true;
      if (shouldNotify(item, ctx, notified.current)) {
        notified.current.add(item.request.id);
        const { title, body } = notificationContent(item);
        const n = new Notification(title, { body, tag: item.request.id });
        n.onclick = () => {
          window.focus();
          onNewRequest();
        };
      }
    }
    known.current = next;
    if (hasNew) onNewRequest();
  });

  return null;
}

export default function App() {
  const controller = useMemo(() => new Controller(), []);
  const route = useRoute();
  const [dockOpen, setDockOpen] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(loadNotifyEnabled);
  const ui = useMemo<UiActions>(() => ({ openDock: () => setDockOpen(true) }), []);

  // Permission is requested only from this explicit toggle click.
  const toggleNotify = () => {
    const next = !notifyEnabled;
    setNotifyEnabled(next);
    saveNotifyEnabled(next);
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
  };

  useEffect(() => {
    controller.connect(controller.config.relays);
    const persist = () => controller.persist();
    addEventListener('pagehide', persist);
    return () => removeEventListener('pagehide', persist);
  }, [controller]);

  // The serve connect link arriving as a hash CHANGE on an already-running
  // tab (a fresh page load ingests in main.tsx before anything mounts):
  // store the credentials, strip the secret, tell the ops panel to reload.
  useEffect(() => {
    const onHash = () => {
      const ingested = ingestOpsConnectHash(location.hash);
      if (!ingested) return;
      saveOpsConfig(ingested);
      history.replaceState(null, '', '#/connections');
      dispatchEvent(new Event('aep-mc:ops-config'));
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // The inbox route IS the attention center — no dock next to it.
  const showDock = route.view !== 'inbox';

  return (
    <ControllerContext.Provider value={controller}>
      <UiContext.Provider value={ui}>
        <EventHoverProvider>
          <AttentionPresence
            controller={controller}
            notifyEnabled={notifyEnabled}
            onNewRequest={() => setDockOpen(true)}
          />
          <div className="flex h-full">
            <Rail notifyEnabled={notifyEnabled} onNotifyToggle={toggleNotify} />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3 p-4">
                <View />
              </div>
            </main>
          </div>
          {/* Overlay: floats above the content, never reflows it. */}
          {showDock && <AttentionDock open={dockOpen} onOpenChange={setDockOpen} />}
        </EventHoverProvider>
      </UiContext.Provider>
    </ControllerContext.Provider>
  );
}
