import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: process.env.ODIP_API_TARGET || 'http://localhost:5100',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // RTL's automatic afterEach(cleanup) and React-act-environment beforeAll/afterAll wiring
    // (dist/index.js) only register themselves when they find global afterEach/beforeAll/afterAll
    // — every test file still imports describe/it/expect/vi explicitly rather than relying on globals.
    globals: true,
    css: false,
  },
})
