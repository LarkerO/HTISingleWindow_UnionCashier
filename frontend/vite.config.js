import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, handler) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') handler(warning);
      },
    },
  },
  server: {
    host: '127.0.0.1',
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: Object.fromEntries(['/api', '/oauth', '/open'].map(path => [path, 'http://127.0.0.1:8787'])),
  },
});
