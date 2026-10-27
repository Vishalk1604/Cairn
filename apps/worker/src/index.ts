import { cron, handle } from './app'
import type { Env } from './env'

export default {
  fetch(request, env) {
    return handle(request, env, { fetch: (input, init) => fetch(input, init) })
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cron(env, { fetch: (input, init) => fetch(input, init) }))
  },
} satisfies ExportedHandler<Env>
