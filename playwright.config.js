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
    // The fake camera lets the camera mode run without a real one.
    // PW_CPU=1 runs a Mac like CI does: no WebGPU (CPU renderer) and software WebGL.
    launchOptions: { args: [...(process.platform === 'darwin' && !process.env.PW_CPU ? ['--enable-unsafe-webgpu', '--use-angle=metal'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: {
    command: 'npx vite preview --port 5292 --strictPort',
    url: 'http://localhost:5292',
    reuseExistingServer: !process.env.CI,
  },
});
