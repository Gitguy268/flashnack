import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0 },
  optimizeDeps: { exclude: ['@jsquash/jpeg', 'libraw-wasm'] },
  server: { port: 5291, strictPort: true },
  test: { include: ['tests/unit/**/*.test.js'] },
});
