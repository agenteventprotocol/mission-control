// Per-view header bar: title on the left, view-specific controls on the
// right. Keeps every view's chrome consistent under the rail layout.
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function ViewHeader({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** Small muted annotation next to the title. */
  meta?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
      <h1 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4.5 text-muted-foreground" aria-hidden />
        {title}
      </h1>
      {meta && <span className="text-xs text-faint">{meta}</span>}
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
