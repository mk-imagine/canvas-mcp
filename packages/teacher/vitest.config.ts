import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: {
      '@canvas-mcp/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup/msw-server.ts'],
    poolOptions: {
      forks: {
        execArgv: ['--no-warnings'],
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage/unit',
      clean: true,
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        '**/*.d.ts',
      ],
    },
  },
})
