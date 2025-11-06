import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 20000,
    isolate: true,
    pool: 'forks',
    onConsoleLog: (log) => {
      // Filter out known noise
      if (log.includes('[Migrations]') ||
        log.includes('relation') ||
        log.includes('does not exist')) {
        return false;
      }
    },
  }
})