import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel / app.baoanpharma.com → base '/'. GitHub Pages docs → VITE_BASE=./
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
