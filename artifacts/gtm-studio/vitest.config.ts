import path from 'path';
import { defineConfig } from 'vitest/config';

// Unit tests only; the browser checks live in e2e/ and run with Playwright.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
