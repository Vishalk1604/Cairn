import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Tauri expects a fixed port and must see Rust-side errors, so don't clear the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
})
