import { defineConfig } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Writes dist/sw.js from src/sw-template.js with the list of files to keep
// offline: everything built except the film looks that are not popular.
function serviceWorker() {
  let outDir;
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  return {
    name: 'flashnack-service-worker',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const catalog = JSON.parse(readFileSync('src/looks/catalog.json', 'utf8'));
      const popular = new Set(catalog.looks.filter((l) => l.popular).map((l) => `luts/look/${l.id}.png`));
      const files = walk(outDir).map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((f) => f !== 'sw.js' && !/(^|\/)\.|\.map$/.test(f) && !/^(robots\.txt|sitemap\.xml|llms\.txt)$/.test(f))
        .filter((f) => !f.startsWith('luts/look/') || popular.has(f))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const list = ['./', ...files.filter((f) => f !== 'index.html').map((f) => `./${f}`)];
      const sw = readFileSync('src/sw-template.js', 'utf8')
        .replace('__CACHE__', `flashnack-${hash.digest('hex').slice(0, 12)}`)
        .replace('__PRECACHE__', JSON.stringify(list, null, 0));
      writeFileSync(join(outDir, 'sw.js'), sw);
      const bytes = files.reduce((s, f) => s + statSync(join(outDir, f)).size, 0);
      console.log(`sw.js: ${list.length} files kept offline, ${(bytes / 1e6).toFixed(1)} MB`);
    },
  };
}

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 900 },
  optimizeDeps: { exclude: ['@jsquash/jpeg', 'libraw-wasm'] },
  server: { port: 5291, strictPort: true },
  test: { include: ['tests/unit/**/*.test.js'] },
  plugins: [serviceWorker()],
});
