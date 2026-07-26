// Capture-aware JSON rendering: digest keys tagged, redaction stand-ins
// highlighted, plain values untouched.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JsonTree } from '../../src/components/event/json-tree';

describe('JsonTree', () => {
  it('tags *_digest values and highlights [REDACTED …] stand-ins', () => {
    render(
      <JsonTree
        value={{
          tool: { name: 'Bash' },
          args_digest: 'sha256:abcd1234',
          output: '[REDACTED 2048 bytes]',
        }}
      />,
    );
    expect(screen.getByText('digest')).toBeTruthy();
    const redacted = screen.getByText(/REDACTED 2048 bytes/);
    expect(redacted.className).toContain('severity-warning');
    expect(screen.getByText('"Bash"').className).not.toContain('severity-warning');
  });

  it('renders nested arrays/objects line by line', () => {
    const { container } = render(<JsonTree value={{ list: [1, true, null], empty: {} }} />);
    expect(container.textContent).toContain('"list"');
    expect(container.textContent).toContain('true');
    expect(container.textContent).toContain('null');
    expect(container.textContent).toContain('{}');
  });
});
