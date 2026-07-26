// jsdom project setup: React act() environment, cleanup between tests, and
// the browser APIs Radix expects that jsdom does not implement.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as Record<string, unknown>).ResizeObserver ??= ResizeObserverStub;

afterEach(() => cleanup());
