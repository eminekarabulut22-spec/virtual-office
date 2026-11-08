import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, 'web'),
  server: {
    port: 3001,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3002', changeOrigin: true },
    },
  },
})
