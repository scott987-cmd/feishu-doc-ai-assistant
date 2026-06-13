/**
 * Vite config for browser-only UI development.
 * Runs the side panel as a plain webpage — no extension context needed.
 *
 *   npm run dev:ui   →   http://localhost:5173/scripts/dev.html
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  root: '.',
  server: {
    port: 5173,
    open: '/scripts/dev.html',
  },
  // Env vars still work (VITE_FEISHU_APP_ID etc.)
})
