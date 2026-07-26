// Small cross-cutting UI affordances (e.g. "open the attention dock from a
// fleet card") without threading callbacks through every view.
import { createContext, useContext } from 'react';

export interface UiActions {
  openDock: () => void;
}

export const UiContext = createContext<UiActions>({ openDock: () => {} });

export function useUi(): UiActions {
  return useContext(UiContext);
}
