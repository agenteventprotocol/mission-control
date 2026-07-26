// Consumer-class self-certification (AEP-0001 §7/§10, AEP-0003 §6–§7): the
// spec's conformance class table tells consumers to drive themselves from the
// golden corpus — it deliberately contains shapes unknown to this app (a
// vendor extension type, extension envelope attributes, foreign-emitter
// seq-less events). This suite feeds the vendored corpus through the real
// store via the real JSONL import path and asserts the class obligations:
// every event applies (tolerated, never dropped), a full-corpus duplicate
// replay changes nothing (dedupe on id), the fourteen mandatory types derive
// the complete lifecycle story (success / failure / cancel run terminals,
// the answered and timed-out attention arcs, the form loop), seq-less
// foreign-emitter events keep arrival order, and cause edges resolve in the
// DAG across the control boundary. The resume/attr-match half of the class
// row rides the headless e2e beats against the fixture relay.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AepEvent } from '@aep/sdk';
import { IMPORT_SOURCE, Store, laneKey } from '../src/core/store';
import { importCapture } from '../src/core/import';

const CORPUS_PATH = fileURLToPath(
  new URL('./fixtures/conformance/golden.jsonl', import.meta.url),
);
const text = readFileSync(CORPUS_PATH, 'utf8');
const rows: AepEvent[] = text
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as AepEvent);

const MAIN = 's_8f2c'; // the worked-example session carrying all three run terminals
const mainRows = rows.filter((r) => r.session === MAIN);
const mainKey = laneKey(IMPORT_SOURCE, MAIN);

const load = (): Store => {
  const store = new Store();
  importCapture(store, text);
  return store;
};

describe('consumer-class conformance: the golden corpus through the real store', () => {
  it('covers every mandatory type and the deliberate unknown shapes', () => {
    // guard the fixture itself: if a re-vendor ever shrinks the corpus, this
    // suite must fail loudly rather than certify against a weaker input
    const types = new Set(rows.map((r) => r.type));
    for (const t of [
      'session.started', 'session.ended',
      'run.started', 'run.finished', 'run.failed', 'run.cancelled',
      'tool.requested', 'tool.completed', 'tool.failed', 'tool.denied',
      'attention.requested', 'attention.answered', 'attention.resolved', 'attention.timeout',
    ]) {
      expect(types, `mandatory type ${t} in the corpus`).toContain(t);
    }
    expect([...types].some((t) => t.startsWith('x.')), 'vendor extension type').toBe(true);
    expect(rows.some((r) => r.seq === undefined && r.session !== undefined),
      'foreign-emitter seq-less events').toBe(true);
    expect(rows.some((r) => r.session === undefined),
      'agent-scoped (unlaned) event').toBe(true);
  });

  it('applies every event; the sessionless liveness event is counted, not laned', () => {
    const store = new Store();
    const result = importCapture(store, text);
    expect(result.skipped).toBe(0);
    expect(result.applied).toBe(rows.filter((r) => r.session !== undefined).length);
    expect(store.unlaned).toBe(rows.filter((r) => r.session === undefined).length);
    expect(result.sessions).toEqual([...new Set(rows.map((r) => r.session).filter(Boolean))]);
  });

  it('keeps the unknown vendor type and extension attributes — never dropped', () => {
    const store = load();
    const lane = store.sessions.get(mainKey)!;
    const vendor = mainRows.find((r) => r.type.startsWith('x.'))!;
    expect(lane.byId.get(vendor.id)?.type).toBe(vendor.type);
    expect(lane.events.some((o) => o.ev.id === vendor.id), 'vendor event rendered in the lane').toBe(true);
    // extension envelope attributes ride along untouched (AEP-0001 §10)
    for (const row of mainRows) {
      const stored = lane.byId.get(row.id) as Record<string, unknown> | undefined;
      for (const key of Object.keys(row)) {
        expect(stored?.[key], `${row.type}.${key} kept`).toEqual(
          (row as Record<string, unknown>)[key],
        );
      }
    }
  });

  it('changes nothing on a full-corpus duplicate replay (dedupe on id)', () => {
    const store = load();
    const lane = store.sessions.get(mainKey)!;
    const before = {
      total: store.totalEvents,
      version: store.version,
      laneEvents: lane.events.length,
      runs: JSON.stringify([...lane.runs.entries()]),
      attention: [...lane.attention.values()].map((a) => a.state).join(),
    };
    const again = importCapture(store, text);
    expect(again.applied).toBe(0);
    expect(store.totalEvents).toBe(before.total);
    expect(store.version).toBe(before.version);
    expect(lane.events.length).toBe(before.laneEvents);
    expect(JSON.stringify([...lane.runs.entries()])).toBe(before.runs);
    expect([...lane.attention.values()].map((a) => a.state).join()).toBe(before.attention);
  });

  it('derives the full lifecycle story: three run terminals, both attention arcs', () => {
    const store = load();
    const lane = store.sessions.get(mainKey)!;
    expect(lane.status).toBe('ended');

    const states = Object.fromEntries(
      [...lane.runs.values()].map((r) => [r.id, r.state]),
    );
    expect(states).toEqual({ r_0042: 'finished', r_0043: 'failed', r_0044: 'cancelled' });
    for (const run of lane.runs.values()) {
      expect(run.startedId, `${run.id} start linked`).toBeTruthy();
      expect(run.endedId, `${run.id} terminal linked`).toBeTruthy();
    }

    // every tool lifecycle member is stored and displayable
    for (const t of ['tool.requested', 'tool.completed', 'tool.failed', 'tool.denied']) {
      const row = mainRows.find((r) => r.type === t)!;
      expect(lane.byId.has(row.id), `${t} stored`).toBe(true);
    }

    // answered arc settles resolved with the answer fact captured
    const requests = mainRows.filter((r) => r.type === 'attention.requested');
    const answered = mainRows.find((r) => r.type === 'attention.answered')!;
    const answeredItem = lane.attention.get(answered.subject as string)!;
    expect(answeredItem.state).toBe('resolved');
    expect(answeredItem.answer).toEqual((answered.data as { answer: unknown }).answer);

    // unanswered arc settles timeout
    const timeout = mainRows.find((r) => r.type === 'attention.timeout')!;
    expect(lane.attention.get(timeout.subject as string)?.state).toBe('timeout');
    expect(lane.attention.size).toBe(requests.length);

    // severity heat mirrors the corpus exactly
    const expected: Record<string, number> = {};
    for (const r of mainRows) expected[r.severity ?? 'info'] = (expected[r.severity ?? 'info'] ?? 0) + 1;
    expect(lane.severityCounts).toEqual(expected);
  });

  it('settles the form loop with structural values and the free-text answer kept', () => {
    const store = load();
    const lane = store.sessions.get(laneKey(IMPORT_SOURCE, 's_form'))!;
    const req = rows.find(
      (r) => r.session === 's_form' && r.type === 'attention.requested',
    )!;
    expect((req.data as { kind?: string }).kind).toBe('form');
    const item = lane.attention.get(req.id)!;
    expect(item.state).toBe('resolved');
    const values = (item.answer as { values: Record<string, unknown> }).values;
    const answeredRow = rows.find(
      (r) => r.session === 's_form' && r.type === 'attention.answered',
    )!;
    expect(values).toEqual(
      (answeredRow.data as { answer: { values: Record<string, unknown> } }).answer.values,
    );
  });

  it('keeps arrival order for foreign-emitter seq-less events among owner events', () => {
    const store = load();
    const lane = store.sessions.get(mainKey)!;
    // the corpus file order IS the arrival order: the fold must reproduce it,
    // interleaving the seq-less command/routing events exactly where they arrived
    expect(lane.events.map((o) => o.ev.id)).toEqual(mainRows.map((r) => r.id));
  });

  it('resolves cause edges in the DAG, including across the control boundary', () => {
    const store = load();
    const dag = store.dag(mainKey);
    const inLane = new Set(mainRows.map((r) => r.id));
    const expectedCauseEdges = mainRows.filter(
      (r) => typeof r.cause === 'string' && inLane.has(r.cause),
    );
    const causeEdges = dag.edges.filter((e) => e.kind === 'cause');
    expect(causeEdges.length).toBe(expectedCauseEdges.length);
    // the §5 outcome contract is a graph fact: command → cause-linked terminal
    const cancelCmd = mainRows.find((r) => r.type === 'control.cancel')!;
    const cancelled = mainRows.find((r) => r.type === 'run.cancelled')!;
    expect(
      causeEdges.some((e) => e.from === cancelCmd.id && e.to === cancelled.id),
      'control.cancel → run.cancelled edge resolves',
    ).toBe(true);
  });
});
