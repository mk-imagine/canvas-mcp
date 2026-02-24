import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Integration tests share Canvas state — run files sequentially
    fileParallelism: false,
    setupFiles: ['tests/setup/integration-env.ts'],
  },
})
