import type { Entity } from '@cairn/core'
import type { Repository, Unsubscribe } from './repository'

/** A remote store that can say when it has heard from the server. */
export interface RemoteRepository<T extends Entity, Q> extends Repository<T, Q> {
  serverSynced(): Promise<void>
}

/**
 * Keeps this device's own store and the cloud in step, with the device's
 * store as the one the app reads and writes.
 *
 * Firestore's web SDK cannot keep a durable cache on React Native — there is
 * no IndexedDB — so writing to it directly would lose anything typed offline
 * the moment the app is killed. Writing locally first and replicating means a
 * note survives a dead battery and reaches the cloud whenever the network
 * comes back.
 *
 * Conflicts need no special handling: both stores merge last-write-wins on
 * the stamp every edit carries, so whichever side wrote last wins on both.
 */
export function replicate<T extends Entity, Q>(
  local: Repository<T, Q>,
  remote: RemoteRepository<T, Q>,
  /** A query matching everything, tombstones included, or deletions never travel. */
  everything: Q,
  /** Who the cloud copy belongs to. Items written before signing in are re-filed under it. */
  userId: string,
): Unsubscribe {
  /** The newest stamp the cloud is known to hold for each id. */
  const cloud = new Map<string, number>()
  let ready = false
  let running = false
  let again = false
  let stopped = false

  const stopRemote = remote.observe(everything, (items) => {
    for (const item of items) cloud.set(item.id, Math.max(cloud.get(item.id) ?? -Infinity, item.updatedAt))
    void local.upsertMany(items)
  })

  const push = async (): Promise<void> => {
    // Before the server has answered, an id missing from the cloud may simply
    // not have arrived yet, and pushing it could overwrite a newer edit made
    // on another device.
    if (!ready || stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      do {
        again = false
        const ahead = (await local.list(everything))
          .filter((item) => item.updatedAt > (cloud.get(item.id) ?? -Infinity) || item.userId !== userId)
          .map((item) => (item.userId === userId ? item : { ...item, userId }))
        if (ahead.length === 0) continue
        for (const item of ahead) cloud.set(item.id, item.updatedAt)
        await remote.upsertMany(ahead)
      } while (again && !stopped)
    } finally {
      running = false
    }
  }

  const stopLocal = local.observe(everything, () => void push())
  void remote.serverSynced().then(() => {
    ready = true
    return push()
  })

  return () => {
    stopped = true
    stopRemote()
    stopLocal()
  }
}
