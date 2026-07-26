// Capture-aware JSON renderer, monochrome: keys muted, values in the ink
// scale, punctuation faint. Color marks only capture semantics — withheld
// content (`[REDACTED …]` stand-ins) carries heat, and `*_digest` keys get
// a neutral tag so a hash never reads as content.
import { memo, type ReactNode } from 'react';

/** The pipeline's stand-in token for withheld content. */
const REDACTION_RE = /\[REDACTED[^\]]*\]/;

const isDigestKey = (key: string | null): boolean => key !== null && key.endsWith('_digest');

function Leaf({ value, jsonKey }: { value: unknown; jsonKey: string | null }) {
  if (value === null || value === undefined) {
    return <span className="text-faint">{String(value)}</span>;
  }
  if (typeof value === 'string') {
    if (isDigestKey(jsonKey)) {
      return (
        <>
          <span className="text-muted-foreground">{JSON.stringify(value)}</span>
          <span className="ml-1.5 rounded-sm border border-border px-1 font-sans text-[10px] text-muted-foreground">
            digest
          </span>
        </>
      );
    }
    if (REDACTION_RE.test(value)) {
      return <span className="text-severity-warning">{JSON.stringify(value)}</span>;
    }
    return <span className="text-foreground">{JSON.stringify(value)}</span>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="text-foreground/80">{String(value)}</span>;
  }
  return <span className="text-faint">{String(value)}</span>;
}

function Line({ indent, children }: { indent: number; children: ReactNode }) {
  return (
    <div className="leading-5 whitespace-pre-wrap" style={{ paddingLeft: `${indent * 1.1}em` }}>
      {children}
    </div>
  );
}

function renderTree(
  value: unknown,
  jsonKey: string | null,
  indent: number,
  trailingComma: boolean,
  keyPath: string,
): ReactNode[] {
  const keyPrefix: ReactNode[] =
    jsonKey !== null
      ? [
          <span key="k" className="text-muted-foreground">
            {JSON.stringify(jsonKey)}
          </span>,
          <span key="c" className="text-faint">
            {': '}
          </span>,
        ]
      : [];
  const comma = trailingComma ? <span className="text-faint">,</span> : null;

  if (value !== null && typeof value === 'object') {
    const isArray = Array.isArray(value);
    const entries: Array<[string | null, unknown]> = isArray
      ? (value as unknown[]).map((v): [string | null, unknown] => [null, v])
      : Object.entries(value as Record<string, unknown>);
    const open = isArray ? '[' : '{';
    const close = isArray ? ']' : '}';

    if (entries.length === 0) {
      return [
        <Line key={keyPath} indent={indent}>
          {keyPrefix}
          <span className="text-faint">{open + close}</span>
          {comma}
        </Line>,
      ];
    }
    return [
      <Line key={`${keyPath}^`} indent={indent}>
        {keyPrefix}
        <span className="text-faint">{open}</span>
      </Line>,
      ...entries.flatMap(([k, v], i) =>
        renderTree(v, k, indent + 1, i < entries.length - 1, `${keyPath}.${k ?? i}`),
      ),
      <Line key={`${keyPath}$`} indent={indent}>
        <span className="text-faint">{close}</span>
        {comma}
      </Line>,
    ];
  }
  return [
    <Line key={keyPath} indent={indent}>
      {keyPrefix}
      <Leaf value={value} jsonKey={jsonKey} />
      {comma}
    </Line>,
  ];
}

export const JsonTree = memo(function JsonTree({ value }: { value: unknown }) {
  return <div className="font-mono text-xs">{renderTree(value, null, 0, false, '$')}</div>;
});
