import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  root: 'client',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: true, // bind all interfaces so the app is reachable over Tailscale
    allowedHosts: ['.ts.net'], // permit tailnet MagicDNS hostnames
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
