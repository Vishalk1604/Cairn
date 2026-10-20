/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** See .env.example. Absent in a clone that has not been set up. */
  readonly VITE_GOOGLE_DESKTOP_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
