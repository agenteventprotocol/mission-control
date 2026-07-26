// Defensive readers for attention-request payloads. The envelope `data` is a
// generic bag, so everything is shape-checked: malformed entries are skipped,
// and an unknown field type degrades the whole form to prompt + free-text
// rather than mis-rendering (AEP-0006 backward compatibility).

export interface Option {
  id: string;
  label: string;
}

export interface FieldSpec {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  label: string;
  required: boolean;
  multi: boolean;
  other: boolean;
  choices: Option[];
  min?: number;
  max?: number;
}

/** `data.options` on an option-style request. */
export function readOptions(data: Record<string, unknown>): Option[] {
  const raw = data.options;
  if (!Array.isArray(raw)) return [];
  const out: Option[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id !== 'string') continue;
    const label = (entry as { label?: unknown }).label;
    out.push({ id, label: typeof label === 'string' && label ? label : id });
  }
  return out;
}

/** `data.fields` on a kind:"form" request (AEP-0006 field_spec). */
export function readFields(data: Record<string, unknown>): FieldSpec[] {
  if (data.kind !== 'form' || !Array.isArray(data.fields)) return [];
  const out: FieldSpec[] = [];
  for (const entry of data.fields) {
    if (!entry || typeof entry !== 'object') continue;
    const f = entry as Record<string, unknown>;
    if (typeof f.id !== 'string') continue;
    if (f.type !== 'string' && f.type !== 'number' && f.type !== 'boolean' && f.type !== 'select') {
      return []; // unknown type: degrade rather than mis-render
    }
    const spec: FieldSpec = {
      id: f.id,
      type: f.type,
      label: typeof f.label === 'string' && f.label ? f.label : f.id,
      required: f.required === true,
      multi: f.multi === true,
      other: f.other === true,
      choices: readOptions({ options: f.choices }),
    };
    if (typeof f.min === 'number') spec.min = f.min;
    if (typeof f.max === 'number') spec.max = f.max;
    out.push(spec);
  }
  return out;
}

export type FieldDraft = Record<string, { value?: string; checked?: boolean; picks?: string[]; other?: string }>;

/**
 * Assemble `answer.values` from a form draft, keyed by field_spec.id.
 * Unanswered fields are omitted; required-field enforcement stays with the
 * emitter (a `control.rejected{invalid}` nack keeps the request pending).
 * For choice fields with other:true, non-empty free text wins over picks.
 */
export function draftValues(fields: FieldSpec[], draft: FieldDraft): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    const d = draft[f.id] ?? {};
    if (f.type === 'string' || f.type === 'number') {
      const v = (d.value ?? '').trim();
      if (!v) continue;
      values[f.id] = f.type === 'number' ? Number(v) : v;
    } else if (f.type === 'boolean') {
      values[f.id] = d.checked === true;
    } else if (f.multi) {
      const other = (d.other ?? '').trim();
      if (other) values[f.id] = other;
      else if (d.picks && d.picks.length > 0) values[f.id] = d.picks;
    } else {
      const other = (d.other ?? '').trim();
      if (other) values[f.id] = other;
      else if (d.value) values[f.id] = d.value;
    }
  }
  return values;
}
