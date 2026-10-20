import { defineConfig } from 'vitest/config'

// The rules suite talks to the Firestore emulator, so it is kept out of the
// ordinary test run and started by `pnpm test:rules`.
export default defineConfig({
  test: {
    include: ['test/rules.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
