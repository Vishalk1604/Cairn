import { defineConfig } from 'vitest/config'

// Date logic is only trustworthy if it's tested somewhere with DST. New York
// shifts in March and November; tests pin their reference dates to it.
process.env.TZ = 'America/New_York'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
})
