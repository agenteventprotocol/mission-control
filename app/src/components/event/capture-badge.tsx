// Capture-level badge for the inspector (AEP-0001 envelope `capture`):
// tells the reader how much payload content the emitter was allowed to
// ship. Monochrome except `redacted` — the one level that means "withheld
// content is present in this payload".
import type { Capture } from '@agenteventprotocol/sdk';
import { Eye, EyeOff, ScanEye, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

const STYLES: Record<string, { cls: string; icon: typeof Eye }> = {
  none: { cls: 'border-border text-faint', icon: EyeOff },
  metadata: { cls: 'border-border text-muted-foreground', icon: ScanEye },
  redacted: { cls: 'border-severity-warning/50 text-severity-warning', icon: Eye },
  full: { cls: 'border-border text-foreground', icon: FileText },
};

export function CaptureBadge({ capture }: { capture: Capture | undefined }) {
  const level = capture ?? 'none';
  const style = STYLES[level] ?? STYLES.none!;
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs',
        style.cls,
      )}
    >
      <Icon className="size-3" aria-hidden />
      capture: {level}
    </span>
  );
}
