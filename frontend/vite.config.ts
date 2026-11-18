import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/** Backend of `npm run sandbox` in backend/ (temporary database + fake ML on this machine). */
const SANDBOX_API_URL = 'http://127.0.0.1:4100/api'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // `npm run dev:sandbox`: the app talks to the throwaway sandbox backend instead of :4000.
  define: mode === 'sandbox' ? { 'import.meta.env.VITE_API_URL': JSON.stringify(SANDBOX_API_URL) } : {},
  server: {
    watch: {
      usePolling: true,
    },
  },
  // Unit tests of pure modules (npm test). Nothing here needs a browser.
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
}))
