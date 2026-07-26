// The shared status dot: one primitive for every connection/process dot, so
// state→color pairs come from the semantic tokens instead of per-site raw
// palette classes — and the breathing live animation is opt-in, never free.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { StatusDot } from '../../src/components/ui/status-dot';

function dotClass(ui: React.ReactElement): string {
  const { container } = render(ui);
  const dot = container.querySelector('span');
  expect(dot).toBeTruthy();
  return dot!.className;
}

describe('StatusDot', () => {
  it('renders each state with its semantic token class', () => {
    expect(dotClass(<StatusDot state="live" />)).toContain('bg-live');
    expect(dotClass(<StatusDot state="connecting" />)).toContain('bg-severity-warning');
    expect(dotClass(<StatusDot state="error" />)).toContain('bg-severity-error');
    expect(dotClass(<StatusDot state="off" />)).toContain('bg-muted-foreground/40');
  });

  it('breathes only when live AND pulse is asked for', () => {
    expect(dotClass(<StatusDot state="live" pulse />)).toContain('mc-live-dot');
    expect(dotClass(<StatusDot state="live" />)).not.toContain('mc-live-dot');
    expect(dotClass(<StatusDot state="connecting" pulse />)).not.toContain('mc-live-dot');
  });

  it('keeps the current dot size and shape by default', () => {
    const cls = dotClass(<StatusDot state="off" />);
    expect(cls).toContain('size-2');
    expect(cls).toContain('rounded-full');
  });
});
