// Event inspector: full envelope + data as a capture-aware JSON tree.
import { useState } from 'react';
import { Check, Copy, MousePointerClick } from 'lucide-react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CaptureBadge } from '@/components/event/capture-badge';
import { SeverityDot } from '@/components/event/severity-dot';
import { JsonTree } from '@/components/event/json-tree';

export function Inspector({ ev }: { ev: AepEvent | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!ev) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-faint">
        <MousePointerClick className="size-6" aria-hidden />
        Select an event to inspect its envelope and data.
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(ev, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable (permissions/insecure context) — leave silent */
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <CaptureBadge capture={ev.capture} />
        <SeverityDot severity={ev.severity} showLabel />
        <Button variant="ghost" size="sm" className="ml-auto" onClick={copy}>
          {copied ? <Check /> : <Copy />}
          {copied ? 'copied' : 'copy JSON'}
        </Button>
      </div>
      <div className="border-b px-3 py-2 font-mono text-xs text-muted-foreground">
        <span className="text-foreground">{ev.type}</span> · {ev.id}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-3">
          <JsonTree value={ev} />
        </div>
      </ScrollArea>
    </div>
  );
}
