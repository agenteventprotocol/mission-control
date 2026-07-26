// Named FleetFilter snapshots in storage. Load is defensive: corrupted
// entries degrade to an empty list, unknown fields are dropped, and
// missing fields fill from the defaults (a saved set from an older build
// stays applicable).
import { DEFAULT_FILTER, type FleetFilter } from './filter-bar';

export interface SavedFilter {
  name: string;
  filter: FleetFilter;
}

const KEY = 'aep-mc:saved-filters';

function sanitize(raw: unknown): FleetFilter {
  const src = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: FleetFilter = { ...DEFAULT_FILTER };
  for (const k of Object.keys(DEFAULT_FILTER) as Array<keyof FleetFilter>) {
    if (typeof src[k] === typeof DEFAULT_FILTER[k]) {
      (out as unknown as Record<string, unknown>)[k] = src[k];
    }
  }
  return out;
}

export type FilterStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** In-memory fallback so a storage-less environment fails soft, not hard. */
function memoryStorage(): FilterStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

export function defaultFilterStorage(): FilterStorage {
  return typeof localStorage === 'undefined' ? memoryStorage() : localStorage;
}

export function savedFilterStore(
  storage: FilterStorage = defaultFilterStorage(),
): {
  list(): SavedFilter[];
  save(name: string, filter: FleetFilter): SavedFilter[];
  remove(name: string): SavedFilter[];
} {
  const load = (): SavedFilter[] => {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (e): e is { name: string; filter?: unknown } =>
            typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string',
        )
        .map((e) => ({ name: e.name, filter: sanitize(e.filter) }));
    } catch {
      return [];
    }
  };
  const persist = (sets: SavedFilter[]): SavedFilter[] => {
    storage.setItem(KEY, JSON.stringify(sets));
    return sets;
  };
  return {
    list: load,
    save: (name, filter) => persist([...load().filter((s) => s.name !== name), { name, filter }]),
    remove: (name) => persist(load().filter((s) => s.name !== name)),
  };
}
