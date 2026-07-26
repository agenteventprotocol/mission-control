// Compact saved-filters picker: apply a named set in one click, save the
// current composition under a name, delete stale sets. Pure localStorage —
// no sync, no export.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { savedFilterStore, type FilterStorage, type SavedFilter } from './saved-filters';
import type { FleetFilter } from './filter-bar';

export function SavedFiltersMenu({
  filter,
  onApply,
  storage,
}: {
  filter: FleetFilter;
  onApply: (f: FleetFilter) => void;
  /** Injectable for tests; defaults to localStorage. */
  storage?: FilterStorage;
}) {
  const store = useMemo(() => savedFilterStore(storage), [storage]);
  const [open, setOpen] = useState(false);
  const [sets, setSets] = useState<SavedFilter[]>(() => store.list());
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <Bookmark aria-hidden />
        Saved
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Saved filters"
          className="absolute right-0 z-30 mt-1 w-64 rounded-lg border bg-popover p-2 shadow-md"
        >
          {sets.length === 0 && (
            <p className="px-1.5 py-1 text-xs text-faint">
              No saved filters yet — compose one below.
            </p>
          )}
          {sets.map((s) => (
            <div key={s.name} className="flex items-center gap-1">
              <button
                type="button"
                role="menuitem"
                className="min-w-0 flex-1 cursor-pointer truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onApply(s.filter);
                  setOpen(false);
                }}
              >
                {s.name}
              </button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Delete saved filter ${s.name}`}
                onClick={() => setSets(store.remove(s.name))}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <form
            className="mt-1.5 flex items-center gap-1.5 border-t border-grid pt-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (!trimmed) return;
              setSets(store.save(trimmed, filter));
              setName('');
            }}
          >
            <Input
              className="h-7 text-xs"
              placeholder="Save current as…"
              aria-label="Filter set name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" size="sm" variant="outline" aria-label="Save filter set">
              <Plus aria-hidden />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
