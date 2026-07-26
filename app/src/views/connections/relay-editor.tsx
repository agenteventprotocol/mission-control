// Inline relay management on the Connections page — the ONE place the relay
// set is edited (the rail gear routes here).
// Most users never open this: the local stack adopts its own relay
// automatically, and the defaults cover the single-relay case. Manual URL +
// token + label editing stays for foreign or remote relays — the learnable,
// fully-manual path.
import { useState } from 'react';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useController, useConnectionStatus } from '@/state/use-store';
import type { RelayEntry } from '@/state/config';

export function RelayEditor() {
  const controller = useController();
  useConnectionStatus(controller);
  const [open, setOpen] = useState(false);
  const [relays, setRelays] = useState<RelayEntry[]>([]);

  const edit = (i: number, patch: Partial<RelayEntry>) =>
    setRelays((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="gap-1.5 text-muted-foreground [&_svg]:size-3.5"
        onClick={() => {
          setRelays(controller.config.relays);
          setOpen(true);
        }}
      >
        <Settings2 /> Manage relays
      </Button>
    );
  }

  const single = relays.length === 1;
  return (
    <form
      className="w-full space-y-3 rounded-lg border border-border bg-card p-3"
      onSubmit={(e) => {
        e.preventDefault();
        controller.connect(relays);
        setOpen(false);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Add or edit relays by hand (URL, token, label). The local stack&rsquo;s own relay is adopted
        automatically — this form is for everything else.
      </p>
      {relays.map((relay, i) => {
        const status = controller.statuses.get(relay.url.trim().replace(/\/$/, ''));
        return (
          <fieldset key={i} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                {status && (
                  <span
                    aria-hidden
                    className={`inline-block size-2 rounded-full ${
                      status.state === 'live'
                        ? 'bg-emerald-500'
                        : status.state === 'error'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground/50'
                    }`}
                  />
                )}
                {single ? 'Relay' : relay.label || `Relay ${i + 1}`}
                {status?.state === 'error' && (
                  <span className="font-normal text-destructive">disconnected</span>
                )}
              </span>
              {!single && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground [&_svg]:size-3.5"
                  title="Remove relay"
                  aria-label={`Remove relay ${relay.label || relay.url}`}
                  onClick={() => setRelays((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <Input
              value={relay.url}
              onChange={(e) => edit(i, { url: e.target.value })}
              placeholder="http://127.0.0.1:8787"
              aria-label="Relay URL"
            />
            <div className="flex gap-2">
              <Input
                value={relay.token}
                onChange={(e) => edit(i, { token: e.target.value })}
                type="password"
                placeholder="token (optional)"
                aria-label="Relay token"
                autoComplete="off"
              />
              <Input
                value={relay.label ?? ''}
                onChange={(e) => edit(i, { label: e.target.value || undefined })}
                placeholder="label (optional)"
                aria-label="Relay label"
                className="max-w-36"
              />
            </div>
          </fieldset>
        );
      })}
      <div className="flex items-center justify-between pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground [&_svg]:size-3.5"
          onClick={() => setRelays((prev) => [...prev, { url: '', token: '' }])}
        >
          <Plus /> Add relay
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit">Apply</Button>
        </div>
      </div>
    </form>
  );
}
