/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cairn's Worker, when it is not the address in packages/sync. See .env.example. */
  readonly VITE_CAIRN_WORKER_URL?: string
}

/** This build's version, from package.json. */
declare const __APP_VERSION__: string

interface ImportMeta {
  readonly env: ImportMetaEnv
}
