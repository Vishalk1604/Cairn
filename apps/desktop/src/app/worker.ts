import { CAIRN_WORKER_URL, currentIdToken, WorkerClient } from '@cairn/sync'

/**
 * Cairn's Worker, as this computer talks to it. The address is the one in
 * packages/sync unless VITE_CAIRN_WORKER_URL says otherwise (see
 * .env.example). Every call carries this computer's Firebase sign-in.
 */
export const worker = new WorkerClient({ url: import.meta.env.VITE_CAIRN_WORKER_URL || CAIRN_WORKER_URL, idToken: currentIdToken })
