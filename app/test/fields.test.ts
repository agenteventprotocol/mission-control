// Form-payload readers: defensive parsing and answer.values assembly
// (AEP-0006 field_spec semantics).
import { describe, expect, it } from 'vitest';
import { readFields, readOptions, draftValues } from '../src/views/inbox/fields';

describe('readOptions', () => {
  it('keeps well-formed entries and falls back to id as label', () => {
    expect(
      readOptions({ options: [{ id: 'allow', label: 'Allow' }, { id: 'deny' }, { nope: 1 }, null] }),
    ).toEqual([
      { id: 'allow', label: 'Allow' },
      { id: 'deny', label: 'deny' },
    ]);
  });

  it('returns empty for non-arrays', () => {
    expect(readOptions({})).toEqual([]);
    expect(readOptions({ options: 'x' })).toEqual([]);
  });
});

describe('readFields', () => {
  const base = { kind: 'form' };

  it('parses every supported field type', () => {
    const fields = readFields({
      ...base,
      fields: [
        { id: 'name', type: 'string', label: 'Name', required: true },
        { id: 'count', type: 'number' },
        { id: 'force', type: 'boolean' },
        { id: 'target', type: 'select', choices: [{ id: 'a' }, { id: 'b', label: 'B' }], other: true },
        { id: 'scopes', type: 'select', multi: true, choices: [{ id: 'x' }] },
      ],
    });
    expect(fields).toHaveLength(5);
    expect(fields[0]).toMatchObject({ id: 'name', required: true, label: 'Name' });
    expect(fields[3]).toMatchObject({ other: true, choices: [{ id: 'a', label: 'a' }, { id: 'b', label: 'B' }] });
    expect(fields[4]!.multi).toBe(true);
  });

  it('reads min/max on number fields and drops malformed bounds', () => {
    const fields = readFields({
      ...base,
      fields: [
        { id: 'count', type: 'number', min: 1, max: 8 },
        { id: 'loose', type: 'number', min: 'low', max: null },
      ],
    });
    expect(fields[0]).toMatchObject({ id: 'count', min: 1, max: 8 });
    expect(fields[1]!.min).toBeUndefined();
    expect(fields[1]!.max).toBeUndefined();
  });

  it('degrades the whole form on an unknown field type (backward compatibility)', () => {
    expect(
      readFields({ ...base, fields: [{ id: 'ok', type: 'string' }, { id: 'new', type: 'date' }] }),
    ).toEqual([]);
  });

  it('returns empty unless kind is form', () => {
    expect(readFields({ fields: [{ id: 'a', type: 'string' }] })).toEqual([]);
  });
});

describe('draftValues', () => {
  const fields = readFields({
    kind: 'form',
    fields: [
      { id: 'name', type: 'string', required: true },
      { id: 'count', type: 'number' },
      { id: 'force', type: 'boolean' },
      { id: 'target', type: 'select', choices: [{ id: 'a' }, { id: 'b' }], other: true },
      { id: 'scopes', type: 'select', multi: true, choices: [{ id: 'x' }, { id: 'y' }], other: true },
    ],
  });

  it('assembles values keyed by field id, omitting unanswered fields', () => {
    expect(
      draftValues(fields, {
        name: { value: '  deploy  ' },
        count: { value: '3' },
        force: { checked: true },
        target: { value: 'b' },
        scopes: { picks: ['x', 'y'] },
      }),
    ).toEqual({ name: 'deploy', count: 3, force: true, target: 'b', scopes: ['x', 'y'] });
  });

  it('lets non-empty other text win over choice picks (the free-text escape)', () => {
    expect(
      draftValues(fields, {
        target: { value: 'a', other: 'something else' },
        scopes: { picks: ['x'], other: 'custom scope' },
      }),
    ).toMatchObject({ target: 'something else', scopes: 'custom scope' });
  });

  it('omits empty strings and empty pick lists (booleans always answer)', () => {
    // A checkbox has no unanswered state, so boolean fields always submit.
    expect(draftValues(fields, { name: { value: '   ' }, scopes: { picks: [] } })).toEqual({
      force: false,
    });
  });
});
