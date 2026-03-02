import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Integration tests share Canvas state — run files sequentially
    fileParallelism: false,
    setupFiles: ['tests/setup/integration-env.ts'],
    poolOptions: {
      forks: {
        execArgv: ['--no-warnings'],
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/integration',
      clean: true,
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'scripts/**',
        '.history/**',
        'src/index.ts',
        'vitest.config.ts',
        'vitest.integration.ts',
      ],
    },
  },
})
