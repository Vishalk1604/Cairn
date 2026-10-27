/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cairn's Worker, when it is not the address in packages/sync. See .env.example. */
  readonly VITE_CAIRN_WORKER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
