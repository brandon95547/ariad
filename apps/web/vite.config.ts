import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:5191'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5190,
    host: true,
    proxy: {
      // The browser only ever talks to one origin, so the session cookie is
      // first-party in dev exactly as it is in production. `/t/` is tracking
      // (open pixels, click redirects) and `/media/` is uploaded images, both
      // served by the API itself.
      //
      // Anchored patterns, not bare prefixes: Vite matches a plain key with
      // startsWith, so '/t' would also take '/templates' away from the app.
      '^/api/': { target: API_TARGET, changeOrigin: true },
      '^/t/': { target: API_TARGET, changeOrigin: true },
      '^/media/': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
})
