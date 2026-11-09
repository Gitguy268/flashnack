# Contributing to Flashnack

Thanks for helping. Bug reports, fixes and new looks are all welcome.

## Run it

```bash
git clone https://github.com/Gitguy268/flashnack.git
cd flashnack
npm install
npm run dev        # http://localhost:5291
```

Or double-click `start.command` (macOS), which installs, builds and opens the app on <http://localhost:5292>.

## Checks

```bash
npm test           # unit tests (Vitest)
npm run build      # production build in dist/
npm run e2e        # Playwright against the build, with synthetic DNGs
```

`npm run e2e` uses small synthetic DNGs made by `tests/fixtures/make-dng.mjs`. To run it on your own photos, set `FLASHNACK_SAMPLES=/folder/with/dngs`. Never commit photos.

On a Mac, Playwright's Chromium gets a real WebGPU adapter. Elsewhere, and on GitHub's runners, the app falls back to the CPU renderer, so CI tests that path.

## Parity with LoFi Logic

The render pipeline is a port of [LoFi Logic](https://github.com/lofilogic/flashback-raw-editor), and it is checked against it pixel for pixel.

1. Make references with the desktop code. You need Python 3.12 and the upstream repo (clone it without Git LFS, and download the six `.cube` files into a `luts/` folder next to the clone):

   ```bash
   python3 -m venv ref-venv
   ref-venv/bin/pip install "numpy<2" rawpy==0.26.1 opencv-python-headless==4.10.0.84 colour-science==0.4.4 ExifRead==3.5.1 scipy==1.13.1 wgpu==0.24.0 pillow
   ref-venv/bin/python tests/parity/make-reference.py <upstream clone> <out dir> photo.dng
   ```

2. With `npm run dev` running:

   ```bash
   REF_DIR=<out dir> DNG=photo.dng NAME=photo node tests/parity/run-parity.mjs        # WebGPU
   CPU=1 REF_DIR=<out dir> DNG=photo.dng NAME=photo node tests/parity/run-parity.mjs  # CPU renderer
   ```

On 2026-11-09 the four sample DNGs matched within 1e-5 (max absolute error, 0..1 scale) in all five looks on WebGPU, and within 5e-5 on the CPU renderer.

## Licence

Flashnack is GPL-3.0, like LoFi Logic. By contributing you agree that your contribution is licensed the same way. Ported files keep a header naming the upstream file and the change; keep that up to date when you change one. New dependencies need a GPL-3.0-compatible licence and a line in `NOTICE`.

## Pull requests

Keep them small and focused, say what you tested, and add a test when you fix a bug.
