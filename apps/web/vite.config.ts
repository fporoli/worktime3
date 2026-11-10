import { defineConfig, defaultClientConditions } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // `source` makes @worktime3/shared resolve to its TypeScript sources, so the web build never needs it built first.
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { port: 3001, proxy: { '/api': 'http://localhost:8001' } },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react-vendor', test: /\/node_modules\/(react|react-dom|scheduler)\// },
            { name: 'mui-charts', test: /\/node_modules\/(@mui\/x-charts|d3-)/ },
            { name: 'mui-pickers', test: /\/node_modules\/(@mui\/x-date-pickers|dayjs)\// },
            { name: 'mui-core', test: /\/node_modules\/(@mui\/|@emotion\/)/ },
            { name: 'i18n-dictionaries', test: /\/src\/dictionaries\.ts$/ },
          ],
        },
      },
    },
  },
});
