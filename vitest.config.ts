import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    // Several test files spawn their own subprocesses and platform-install loops.
    // Bound file-level parallelism so nested work does not starve individual tests.
    maxWorkers: 4,
    include: ['test/**/*.test.ts'],
    exclude: [
      // Benchmark tests are developer-only tools, not part of CI validation
      'test/**/context-compression-benchmark.test.ts',
      'test/**/context-execution-benchmark.test.ts',
    ],
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['app/**/*.ts', 'domains/**/*.ts', 'platform/**/*.ts'],
      exclude: [
        // Classic runtime behavior is generated to .mjs and exercised through subprocess smoke tests.
        'domains/comet-classic/**',
      ],
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
