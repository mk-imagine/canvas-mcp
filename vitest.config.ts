import { defineConfig } from 'vitest/config'

export default defineConfig({
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
