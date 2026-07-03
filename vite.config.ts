import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // Expose VITE_* (default) plus the un-prefixed GOOGLE_MAPS_API_KEY to
  // client code via import.meta.env.
  envPrefix: ['VITE_', 'GOOGLE_MAPS_API_KEY'],
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    proxy: {
      // Dev API proxy → `/api/*` is forwarded to the Laravel backend.
      // Defaults to the LOCAL backend (`php artisan serve` on :8000) for local
      // dev. Override for staging with VITE_API_PROXY_TARGET, e.g.
      //   VITE_API_PROXY_TARGET=https://api.whoifollow.tech
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false
      }
    }
  }
})
