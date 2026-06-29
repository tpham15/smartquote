import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          xlsx: ['xlsx'],
        }
      }
    }
  },
  server: {
    headers: {
      // Cho phép gọi Anthropic API từ browser
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.anthropic.com https://google.serper.dev https://www.googleapis.com"
    }
  }
})
