// Saved-filters round-trip through one storage across two mounts: save the
// current composition, remount fresh (a reload), apply it back.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DEFAULT_FILTER, type FleetFilter } from '../../src/views/fleet/filter-bar';
import { SavedFiltersMenu } from '../../src/views/fleet/saved-filters-menu';
import type { FilterStorage } from '../../src/views/fleet/saved-filters';

const composed: FleetFilter = {
  ...DEFAULT_FILTER,
  query: 'sim',
  pendingOnly: true,
  lens: 'warning',
  sort: 'attention',
};

function fakeStorage(): FilterStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('SavedFiltersMenu', () => {
  it('saves the current composition and applies it after a remount', () => {
    const storage = fakeStorage();
    const first = render(
      <SavedFiltersMenu filter={composed} onApply={() => {}} storage={storage} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /saved/i }));
    fireEvent.change(screen.getByLabelText('Filter set name'), { target: { value: 'hot lanes' } });
    fireEvent.click(screen.getByRole('button', { name: /save filter set/i }));
    expect(screen.getByRole('menuitem', { name: 'hot lanes' })).toBeTruthy();
    first.unmount();
    cleanup();

    // fresh mount = page reload; the set must come back from storage
    const onApply = vi.fn();
    render(<SavedFiltersMenu filter={DEFAULT_FILTER} onApply={onApply} storage={storage} />);
    fireEvent.click(screen.getByRole('button', { name: /saved/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'hot lanes' }));
    expect(onApply).toHaveBeenCalledWith(composed);
  });

  it('deletes a saved set', () => {
    render(<SavedFiltersMenu filter={composed} onApply={() => {}} storage={fakeStorage()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved/i }));
    fireEvent.change(screen.getByLabelText('Filter set name'), { target: { value: 'stale' } });
    fireEvent.click(screen.getByRole('button', { name: /save filter set/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete saved filter stale/i }));
    expect(screen.queryByRole('menuitem', { name: 'stale' })).toBeNull();
  });
});
