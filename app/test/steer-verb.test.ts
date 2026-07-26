// The composer's vendor-verb table (core/steer-verbs.ts): the convergent
// adapters share x.{agent}.control.instruct { text }; Cline is the one
// declared divergence — x.cline.control.send_input is user-plane input (the
// vendor queues it as a pending prompt), so it carries its own verb, payload
// (polite default delivery "queue"), label, and outcome-event name. Pure
// module, no mocks: this is the table the SteerButton and Connection share.
import { describe, expect, it } from 'vitest';
import { steerVerb } from '../src/core/steer-verbs';

describe('steerVerb', () => {
  it('derives the convergent instruct verb for steering adopters', () => {
    for (const agent of ['claude-code', 'codex', 'qwen-code']) {
      const verb = steerVerb(agent);
      expect(verb.type).toBe(`x.${agent}.control.instruct`);
      expect(verb.data('Prefer staging.')).toEqual({ text: 'Prefer staging.' });
      expect(verb.label).toBe('Steer');
      expect(verb.deliveredEvent).toBe('instruction.delivered');
    }
  });

  it('gives cline its own user-plane verb with the polite queue default', () => {
    const verb = steerVerb('cline');
    expect(verb.type).toBe('x.cline.control.send_input');
    expect(verb.data('Focus on tests.')).toEqual({ text: 'Focus on tests.', delivery: 'queue' });
    expect(verb.label).toBe('Send input');
    expect(verb.deliveredEvent).toBe('input.sent');
  });

  it('gives openhands its own user-plane verb (an appended user message, never a run trigger)', () => {
    const verb = steerVerb('openhands');
    expect(verb.type).toBe('x.openhands.control.send_input');
    // one append plane: no delivery field (unlike cline's queue/steer)
    expect(verb.data('Focus on tests.')).toEqual({ text: 'Focus on tests.' });
    expect(verb.label).toBe('Send input');
    expect(verb.deliveredEvent).toBe('input.sent');
  });

  it('never mislabels the user-plane verb as advisory steering', () => {
    // the honesty invariant behind the split: different act, different words
    for (const agent of ['cline', 'openhands']) {
      expect(steerVerb(agent).description).toContain('user input');
      expect(steerVerb(agent).description).not.toContain('advisory context that');
    }
    expect(steerVerb('claude-code').description).toContain('advisory');
  });
});
