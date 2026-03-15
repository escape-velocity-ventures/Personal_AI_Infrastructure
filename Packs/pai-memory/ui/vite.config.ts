import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true, rewrite: (p) => p },
      '/search': { target: 'http://localhost:3000', changeOrigin: true },
      '/remember': { target: 'http://localhost:3000', changeOrigin: true },
      '/sources': { target: 'http://localhost:3000', changeOrigin: true },
      '/credentials': { target: 'http://localhost:3000', changeOrigin: true },
      '/import': { target: 'http://localhost:3000', changeOrigin: true },
      '/export': { target: 'http://localhost:3000', changeOrigin: true },
      '/stats': { target: 'http://localhost:3000', changeOrigin: true },
      '/me': { target: 'http://localhost:3000', changeOrigin: true },
      '/tenants': { target: 'http://localhost:3000', changeOrigin: true },
      '/health': { target: 'http://localhost:3000', changeOrigin: true },
      '/chunk': { target: 'http://localhost:3000', changeOrigin: true },
      '/entity': { target: 'http://localhost:3000', changeOrigin: true },
      '/bootstrap': { target: 'http://localhost:3000', changeOrigin: true },
    }
  },
  base: '/ui/',
  build: { outDir: 'dist' }
});
