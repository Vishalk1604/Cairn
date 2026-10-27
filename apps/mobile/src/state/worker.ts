import { CAIRN_WORKER_URL, currentIdToken, WorkerClient } from '@cairn/sync'

declare const process: { env: Record<string, string | undefined> }

/**
 * Cairn's Worker, as the phone talks to it. The address is the one in
 * packages/sync unless EXPO_PUBLIC_CAIRN_WORKER_URL says otherwise, which
 * Expo builds into the app. Every call carries the phone's Firebase sign-in.
 */
export const worker = new WorkerClient({ url: process.env.EXPO_PUBLIC_CAIRN_WORKER_URL || CAIRN_WORKER_URL, idToken: currentIdToken })
