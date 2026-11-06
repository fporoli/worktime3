import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `source` makes @worktime3/shared resolve to its TypeScript sources, so the web build never needs it built first.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { port: 3001, proxy: { '/api': 'http://localhost:8001' } },
});
