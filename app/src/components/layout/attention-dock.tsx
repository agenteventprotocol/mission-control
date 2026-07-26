// The attention dock: the product's core job — "an agent needs me" — made
// ambient. It is a floating overlay that slides in from the right on every
// screen — it never reflows the content underneath. It auto-opens when a
// NEW request arrives (App owns that) and answers inline with the full
// card renderer. A collapsed dock with pending items leaves a recall pill.
import { useEffect, useState } from 'react';
import { BellRing, PanelRightClose } from 'lucide-react';
import type { AttentionItem } from '@/core/store';
import { useController, useStoreVersion } from '@/state/use-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AttentionCard } from '@/views/inbox/attention-card';

const AGE_TICK_MS = 1000;

export function AttentionDock({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const controller = useController();
  useStoreVersion(controller.store);
  const items = controller.store.pendingAttention();

  const hasItems = items.length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open || !hasItems) return;
    const t = setInterval(() => setNow(Date.now()), AGE_TICK_MS);
    return () => clearInterval(t);
  }, [open, hasItems]);

  const respond = (item: AttentionItem, answer: Parameters<typeof controller.respond>[1]) =>
    controller.respond(item, answer);

  if (items.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="fixed right-4 bottom-4 z-40 flex cursor-pointer items-center gap-2 rounded-full border border-family-attention/50 bg-card py-2 pr-4 pl-3 text-sm font-medium shadow-lg transition-transform hover:scale-105"
        aria-label={`Open attention dock — ${items.length} pending`}
      >
        <BellRing className="size-4 text-family-attention" aria-hidden />
        {items.length} need{items.length === 1 ? 's' : ''} you
      </button>
    );
  }

  return (
    <aside
      aria-label="Pending attention"
      className="mc-dock fixed top-3 right-3 bottom-3 z-40 flex w-[380px] max-w-[calc(100vw-88px)] flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <BellRing className="size-4 text-family-attention" aria-hidden />
        <h2 className="text-sm font-semibold">Needs you</h2>
        <span className="rounded-full bg-family-attention/15 px-2 text-xs font-semibold text-family-attention">
          {items.length}
        </span>
        <button
          type="button"
          className="ml-auto cursor-pointer rounded-md p-1.5 text-faint transition-colors hover:bg-accent hover:text-foreground"
          title="Collapse dock"
          aria-label="Collapse attention dock"
          onClick={() => onOpenChange(false)}
        >
          <PanelRightClose className="size-4" aria-hidden />
        </button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 p-2.5">
          {items.map((item) => (
            <AttentionCard key={item.request.id} item={item} now={now} respond={respond} compact />
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}
