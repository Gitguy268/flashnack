import { defineConfig } from '@playwright/test';

// Runs against the production build (npm run build) served by vite preview.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5292',
    // On a Mac these give headless Chromium a real WebGPU adapter; elsewhere the app uses its CPU renderer.
    launchOptions: { args: process.platform === 'darwin' ? ['--enable-unsafe-webgpu', '--use-angle=metal'] : [] },
  },
  webServer: {
    command: 'npx vite preview --port 5292 --strictPort',
    url: 'http://localhost:5292',
    reuseExistingServer: !process.env.CI,
  },
});
