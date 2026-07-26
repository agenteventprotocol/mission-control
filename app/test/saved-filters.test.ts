// Saved filter sets: named FleetFilter snapshots that round-trip through
// storage; corrupted entries degrade to an empty list, never a throw.
import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, type FleetFilter } from '../src/views/fleet/filter-bar';
import { savedFilterStore } from '../src/views/fleet/saved-filters';

function fakeStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const warnings: FleetFilter = {
  ...DEFAULT_FILTER,
  query: 'sim',
  status: 'active',
  pendingOnly: true,
  lens: 'warning',
};

describe('savedFilterStore', () => {
  it('round-trips: save, list from a fresh store over the same storage, apply-equal', () => {
    const storage = fakeStorage();
    savedFilterStore(storage).save('hot lanes', warnings);

    const reloaded = savedFilterStore(storage).list();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]!.name).toBe('hot lanes');
    expect(reloaded[0]!.filter).toEqual(warnings);
  });

  it('overwrites an existing name instead of duplicating it', () => {
    const storage = fakeStorage();
    const store = savedFilterStore(storage);
    store.save('mine', warnings);
    store.save('mine', DEFAULT_FILTER);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.filter).toEqual(DEFAULT_FILTER);
  });

  it('removes by name', () => {
    const storage = fakeStorage();
    const store = savedFilterStore(storage);
    store.save('a', warnings);
    store.save('b', DEFAULT_FILTER);
    store.remove('a');
    expect(store.list().map((s) => s.name)).toEqual(['b']);
  });

  it('degrades corrupted storage to an empty list', () => {
    const storage = fakeStorage({ 'aep-mc:saved-filters': '{not json' });
    expect(savedFilterStore(storage).list()).toEqual([]);
  });

  it('drops unknown fields and fills missing ones from the defaults on load', () => {
    const storage = fakeStorage({
      'aep-mc:saved-filters': JSON.stringify([
        { name: 'old', filter: { query: 'x', bogus: true } },
      ]),
    });
    const [loaded] = savedFilterStore(storage).list();
    expect(loaded!.filter).toEqual({ ...DEFAULT_FILTER, query: 'x' });
  });
});
