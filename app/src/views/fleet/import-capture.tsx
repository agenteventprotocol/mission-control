// "Open capture…" — load one or more JSONL capture files (the durable
// sink's output shape) into the store as offline lanes. Pairs with the
// fleet view's drag-and-drop; both funnel through importFiles().
import { useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import type { Store } from '@/core/store';
import { importCapture, type ImportResult } from '@/core/import';
import { Button } from '@/components/ui/button';

export async function importFiles(store: Store, files: Iterable<File>): Promise<ImportResult> {
  const total: ImportResult = { applied: 0, skipped: 0, sessions: [] };
  for (const file of files) {
    const result = importCapture(store, await file.text());
    total.applied += result.applied;
    total.skipped += result.skipped;
    for (const s of result.sessions) if (!total.sessions.includes(s)) total.sessions.push(s);
  }
  return total;
}

export function summarizeImport(r: ImportResult): string {
  const sessions = `${r.sessions.length} session${r.sessions.length === 1 ? '' : 's'}`;
  const skipped = r.skipped > 0 ? `, ${r.skipped} unreadable line${r.skipped === 1 ? '' : 's'} skipped` : '';
  return `imported ${r.applied} event${r.applied === 1 ? '' : 's'} into ${sessions}${skipped}`;
}

export function ImportCapture({ store, lastSummary }: { store: Store; lastSummary?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState('');
  const shown = summary || lastSummary || '';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".jsonl,.ndjson,application/x-ndjson"
        multiple
        className="hidden"
        aria-label="Capture files"
        onChange={(e) => {
          const files = e.currentTarget.files;
          if (!files || files.length === 0) return;
          void importFiles(store, files).then((r) => setSummary(summarizeImport(r)));
          e.currentTarget.value = '';
        }}
      />
      <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
        <FileUp aria-hidden />
        Open capture…
      </Button>
      {shown && (
        <span role="status" className="truncate text-xs text-muted-foreground">
          {shown}
        </span>
      )}
    </div>
  );
}
