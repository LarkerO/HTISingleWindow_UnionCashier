import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'cashier-docs-entry',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (/^\/docs(?:\/[a-z-]+)?\/?(?:\?|$)/.test(req.url ?? '')) req.url = '/docs.html';
        next();
      });
    },
  }],
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../backend/public',
    // The independently built mobile frontend lives under public/mobile/.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        cashier: fileURLToPath(new URL('index.html', import.meta.url)),
        docs: fileURLToPath(new URL('docs.html', import.meta.url)),
      },
      onwarn(warning, handler) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning);
      },
    },
  },
  preview: { host: '127.0.0.1', port: 48001, strictPort: true },
  server: {
    host: '127.0.0.1',
    port: 48000,
    strictPort: true,
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: {
      ...Object.fromEntries(['/api', '/oauth', '/open'].map(path => [path, 'http://127.0.0.1:48787'])),
      '/mobile': 'http://127.0.0.1:48002',
    },
  },
});
