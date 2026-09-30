import { defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// The public landing page lives at /welcome/ as its own HTML entry (welcome/index.html).
// A signed-out visitor to exactly "/" must reach it without the login page flashing, so the app's
// <head> gets one tiny classic script (welcome/route-gate.js). The CSP allows same-origin scripts
// only, so it is built as a hashed asset and injected here, which leaves index.html untouched.
function routeGate(): Plugin {
  const entry = 'welcome/route-gate.js'
  const appIndex = path.resolve(__dirname, 'index.html')
  return {
    name: 'odip-route-gate',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (path.resolve(ctx.filename) !== appIndex) return
        const chunk = ctx.bundle
          ? Object.values(ctx.bundle).find(
              (o) => o.type === 'chunk' && o.isEntry && o.facadeModuleId?.replace(/\\/g, '/').endsWith('/' + entry),
            )
          : undefined
        return [{ tag: 'script', attrs: { src: chunk ? '/' + chunk.fileName : '/' + entry }, injectTo: 'head-prepend' }]
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), routeGate()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'index.html'),
        welcome: path.resolve(__dirname, 'welcome/index.html'),
        'route-gate': path.resolve(__dirname, 'welcome/route-gate.js'),
      },
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
    // The 5000ms default is unrealistic for the ParticipantCreatePage wizard's full 11-step
    // traversal tests on a slow CI builder (the Docker image build's `npm test` gate) — bump
    // both so a legitimately slow render/validation cycle doesn't get flagged as a hang.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
