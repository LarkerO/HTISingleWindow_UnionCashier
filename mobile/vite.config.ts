import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/mobile/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: '../backend/public/mobile', emptyOutDir: true },
  server: {
    host: '127.0.0.1', port: 48002, strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: Object.fromEntries(['/api', '/oauth', '/open'].map(path => [path, 'http://127.0.0.1:48787'])),
  },
  preview: { host: '127.0.0.1', port: 48003, strictPort: true },
});
