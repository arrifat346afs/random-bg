import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// FX Forge — static build. No runtime network calls: everything is bundled.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // `import.meta.dirname` (Node 20.11+) instead of `__dirname`, which the
      // native config loader rejects with a deprecation warning.
      '@': `${import.meta.dirname}/src`,
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
})
