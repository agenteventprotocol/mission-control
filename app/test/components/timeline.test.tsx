// Session timeline: the replay window caps which indices render and the
// text filter narrows rows — both without touching store state. The
// virtualizer is mocked flat (jsdom has no layout), so these tests pin the
// windowing/filter logic upstream of it.
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { AepEvent } from '@agenteventprotocol/sdk';
import type { Lane, OrderedEvent } from '../../src/core/store';
import { Timeline } from '../../src/views/session/timeline';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 32,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, size: 32, start: index * 32 })),
    scrollToIndex: () => {},
  }),
}));

const TYPES = ['run.started', 'tool.started', 'tool.completed', 'run.finished', 'session.ended'];

const orderedEvent = (i: number): OrderedEvent => ({
  ev: {
    aep: '0.1',
    id: `ev_${i}`,
    type: TYPES[i],
    time: new Date(1700000000000 + i * 1000).toISOString(),
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_timeline',
    seq: i,
    epoch: 1,
  } as AepEvent,
  ord: i,
});

const lane = (events: OrderedEvent[]): Lane => ({
  key: 's_timeline',
  session: 's_timeline',
  source: { kind: 'import' },
  status: 'active',
  events,
  byId: new Map(),
  runs: new Map(),
  attention: new Map(),
  lastActivity: 0,
  gap: false,
  severityCounts: {},
  control: new Map(),
  kindsSeen: new Set(),
  trimmed: 0,
  version: 1,
});

const renderTimeline = (
  win: [number, number],
  filter = '',
  onSelect: (id: string) => void = () => {},
) =>
  render(
    <Timeline
      lane={lane(TYPES.map((_, i) => orderedEvent(i)))}
      window={win}
      live={false}
      filter={filter}
      selectedId={null}
      onSelect={onSelect}
    />,
  );

describe('Timeline replay window', () => {
  it('renders ONLY the [start, end) window slice', () => {
    const { getAllByRole } = renderTimeline([1, 3]);
    const rows = getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('started'); // tool.started (index 1)
    expect(rows[0]!.textContent).toContain('tool.');
    expect(rows[1]!.textContent).toContain('completed'); // tool.completed (index 2)
    expect(rows.some((r) => r.textContent?.includes('finished'))).toBe(false);
    expect(rows.some((r) => r.textContent?.includes('ended'))).toBe(false);
  });

  it('a full window renders every event', () => {
    const { getAllByRole } = renderTimeline([0, 5]);
    expect(getAllByRole('button')).toHaveLength(5);
  });

  it('the text filter narrows rows WITHIN the window', () => {
    const full = renderTimeline([0, 5], 'tool');
    expect(full.getAllByRole('button')).toHaveLength(2);
    full.unmount();

    const windowed = renderTimeline([1, 3], 'completed');
    const rows = windowed.getAllByRole('button');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('completed');
  });

  it('clicking a row selects its event id', () => {
    const onSelect = vi.fn();
    const { getAllByRole } = renderTimeline([1, 3], '', onSelect);
    fireEvent.click(getAllByRole('button')[0]!);
    expect(onSelect).toHaveBeenCalledWith('ev_1');
  });
});
