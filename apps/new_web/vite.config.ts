import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  // File change events do not reach WSL from a Windows drive (/mnt/c), so poll for edits
  server: {
    watch: { usePolling: true, interval: 500 },
  },
})
