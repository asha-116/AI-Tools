import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      include: [
        'tools-core/src/**/*.ts',
        'workers/*/src/**/*.ts',
        'site/src/tools/*/logic.ts',
        'site/src/lib/**/*.ts',
      ],
      reporter: ['text', 'json-summary'],
      // Formula code is money-adjacent: see AGENTS.md ("Tests first").
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
