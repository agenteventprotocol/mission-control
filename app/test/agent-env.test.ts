// Persisted start env is keyed by an ARBITRARY string id — agents today,
// and with the extended ops surface also 'relay' and bridge ids ride the
// same store without special cases (argv-string env keys included).
import { describe, expect, it } from 'vitest';
import { loadAgentEnv, saveAgentEnv, type ConfigStorage } from '../src/state/config';

function memStorage(): ConfigStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('agent env persistence', () => {
  it('keys by arbitrary ids — relay and bridge ids ride beside agents, isolated', () => {
    const storage = memStorage();
    saveAgentEnv('hermes', { AEP_INSTRUCT: '1' }, storage);
    saveAgentEnv('relay', { AEP_BUFFER: '2000' }, storage);
    saveAgentEnv('bridge-kilocode-sse', { '--vendor': 'codex' }, storage);
    expect(loadAgentEnv('hermes', storage)).toEqual({ AEP_INSTRUCT: '1' });
    expect(loadAgentEnv('relay', storage)).toEqual({ AEP_BUFFER: '2000' });
    // argv-backed keys are plain strings to the store
    expect(loadAgentEnv('bridge-kilocode-sse', storage)).toEqual({ '--vendor': 'codex' });
    expect(loadAgentEnv('bridge-acp', storage)).toEqual({});
  });

  it('overwrites one id without touching the others', () => {
    const storage = memStorage();
    saveAgentEnv('relay', { AEP_BUFFER: '2000' }, storage);
    saveAgentEnv('hermes', { AEP_INSTRUCT: '1' }, storage);
    saveAgentEnv('relay', { AEP_MAX_BODY: '123' }, storage);
    expect(loadAgentEnv('relay', storage)).toEqual({ AEP_MAX_BODY: '123' });
    expect(loadAgentEnv('hermes', storage)).toEqual({ AEP_INSTRUCT: '1' });
  });
});
