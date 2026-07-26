/// <reference types="vitest/config" />
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: { port: 8788 },
  preview: { port: 8788 },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/*.test.ts'],
          exclude: ['test/e2e.test.ts', 'test/e2e-multi.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['test/components/**/*.test.tsx'],
          setupFiles: ['test/components/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['test/e2e.test.ts', 'test/e2e-multi.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
