import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri expects a fixed port and must see Rust-side errors, so don't clear the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output lives inside this package; watching it makes the dev
    // server crash with EBUSY the moment cargo rewrites the binary.
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
