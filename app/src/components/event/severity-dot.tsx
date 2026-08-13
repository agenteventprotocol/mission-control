// Severity indicator: a status-colored dot that is never color-alone — the
// label rides along visibly or via the title/aria text.
import type { Severity } from '@agenteventprotocol/sdk';
import { cn } from '@/lib/utils';

const SEVERITY_DOT: Record<string, string> = {
  debug: 'bg-severity-debug',
  info: 'bg-severity-info',
  notice: 'bg-severity-notice',
  warning: 'bg-severity-warning',
  error: 'bg-severity-error',
  critical: 'bg-severity-critical',
};

export function SeverityDot({
  severity,
  showLabel = false,
  className,
}: {
  severity: Severity | undefined;
  showLabel?: boolean;
  className?: string;
}) {
  const sev = severity ?? 'info';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5', className)}
      title={showLabel ? undefined : `severity: ${sev}`}
    >
      <span
        aria-hidden
        className={cn('size-1.5 shrink-0 rounded-full', SEVERITY_DOT[sev] ?? SEVERITY_DOT.info)}
      />
      {showLabel ? (
        <span className="text-xs text-muted-foreground">{sev}</span>
      ) : (
        <span className="sr-only">severity: {sev}</span>
      )}
    </span>
  );
}
