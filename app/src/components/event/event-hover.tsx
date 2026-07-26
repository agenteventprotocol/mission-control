// One shared floating hover card for event glyphs (chips, graph nodes):
// a single portal-rendered layer instead of per-element native tooltips —
// thousands of chips share these two DOM nodes.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { AepEvent } from '@aep/sdk';
import { formatClock } from '@/lib/format';
import { summarize } from '@/lib/summary';
import { SeverityDot } from './severity-dot';

const SHOW_DELAY_MS = 120;
const CARD_W = 260;

interface HoverApi {
  show: (ev: AepEvent, anchor: Element) => void;
  hide: () => void;
}

const EventHoverContext = createContext<HoverApi>({ show: () => {}, hide: () => {} });

export function useEventHover(): HoverApi {
  return useContext(EventHoverContext);
}

export function EventHoverProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ ev: AepEvent; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((ev: AepEvent, anchor: Element) => {
    if (timer.current) clearTimeout(timer.current);
    const rect = anchor.getBoundingClientRect();
    timer.current = setTimeout(() => {
      const half = CARD_W / 2;
      const x = Math.min(Math.max(rect.left + rect.width / 2, half + 8), window.innerWidth - half - 8);
      setState({ ev, x, y: rect.top - 8 });
    }, SHOW_DELAY_MS);
  }, []);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setState(null);
  }, []);

  const api = useMemo(() => ({ show, hide }), [show, hide]);

  return (
    <EventHoverContext.Provider value={api}>
      {children}
      {state &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
            style={{ left: state.x, top: state.y, width: CARD_W }}
          >
            <div className="font-mono text-xs font-medium text-foreground">{state.ev.type}</div>
            {summarize(state.ev) && (
              <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                {summarize(state.ev)}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 text-[11px] text-faint">
              <span className="font-mono tabular-nums">{formatClock(String(state.ev.time))}</span>
              <SeverityDot severity={state.ev.severity} showLabel />
              {typeof state.ev.seq === 'number' && (
                <span className="ml-auto font-mono tabular-nums">seq {state.ev.seq}</span>
              )}
            </div>
          </div>,
          document.body,
        )}
    </EventHoverContext.Provider>
  );
}
