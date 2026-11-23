import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev mode (./start.sh dev) the UI runs on :5173 and forwards API calls
// and the engine WebSocket to the Python server.
const backend = process.env.TIMUR_BACKEND ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': { target: backend, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
})
