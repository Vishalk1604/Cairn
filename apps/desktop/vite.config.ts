import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// Tauri expects a fixed port and must see Rust-side errors, so don't clear the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Shown in Settings → About, and what an update is compared with.
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output lives inside this package; watching it makes the dev
    // server crash with EBUSY the moment cargo rewrites the binary.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
