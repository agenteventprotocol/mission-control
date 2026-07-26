// The "Open capture…" entry: picking a JSONL file feeds the store through
// the import path (offline lane, counted summary, torn line skipped).
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IMPORT_SOURCE, Store, laneKey } from '../../src/core/store';
import { ImportCapture } from '../../src/views/fleet/import-capture';

const line = (id: string, type: string, seq: number): string =>
  JSON.stringify({
    aep: '0.1',
    id,
    type,
    time: '2024-01-01T00:00:00Z',
    source: 'aep://test/agent/sim',
    agent: 'sim',
    session: 's_file',
    seq,
    epoch: 1,
  });

function pickFile(text: string): void {
  const input = screen.getByLabelText('Capture files') as HTMLInputElement;
  const file = new File([text], 'capture.jsonl', { type: 'application/x-ndjson' });
  Object.defineProperty(input, 'files', { value: [file] });
  fireEvent.change(input);
}

describe('ImportCapture', () => {
  it('imports a picked capture file and reports the counted summary', async () => {
    const store = new Store();
    render(<ImportCapture store={store} />);

    fireEvent.click(screen.getByRole('button', { name: /open capture/i }));
    pickFile(`${line('ev_1', 'session.started', 0)}\n${line('ev_2', 'session.ended', 1)}\n{"torn`);

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'imported 2 events into 1 session, 1 unreadable line skipped',
      ),
    );
    expect(store.sessions.get(laneKey(IMPORT_SOURCE, 's_file'))!.source.kind).toBe('import');
    expect(store.sessions.get(laneKey(IMPORT_SOURCE, 's_file'))!.status).toBe('ended');
  });
});
