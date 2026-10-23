import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// `npm run build` → dist/, which server.mjs serves with the API. `npm run dev` proxies the API to a running server.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@/space': path.resolve(import.meta.dirname, 'src/space/index.js'), '@': path.resolve(import.meta.dirname, 'src') } },
  server: { host: '127.0.0.1', proxy: { '/api': `http://127.0.0.1:${process.env.ADMIN_PORT || 8080}` } },
  build: { target: 'es2022' },
})
