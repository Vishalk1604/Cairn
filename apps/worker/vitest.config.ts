import { defineConfig } from 'vitest/config'

// The Worker runs in UTC, so the tests do too: anything that depends on the
// person's own clock has to go through zone.ts to pass.
process.env.TZ = 'UTC'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
