<div align="center">

# Flashnack

Develop your Flashback ONE35 photos in the browser. Drop a roll, pick a film look, export.

[Try it](https://gitguy268.github.io/flashnack/) · [Film looks](#film-looks) · [Camera mode](#camera-mode) · [How it works](#how-it-works) · [Run it locally](#run-it-locally-step-by-step) · [Controls](#controls) · [Contributing](CONTRIBUTING.md)

![GPL-3.0 licence](https://img.shields.io/badge/licence-GPL--3.0-blue)
![Runs in the browser](https://img.shields.io/badge/runs%20in-the%20browser-teal)
![No upload](https://img.shields.io/badge/upload-none-lightgrey)
![WebGPU with CPU fallback](https://img.shields.io/badge/WebGPU-CPU%20fallback-green)
![Works offline](https://img.shields.io/badge/works-offline-orange)

![Flashnack with two photos on the roll: the viaduct in the Rangefinder look, the five looks on the right and the film strip below](docs/images/desktop.webp)

</div>

Flashnack is a web version of [LoFi Logic](https://github.com/lofilogic/flashback-raw-editor), the desktop RAW editor for the [Flashback](https://joinflashback.co) ONE35 camera. It uses the same colour pipeline, the same five film looks and the same effects (halation, bloom, grain, softness, vignette), ported to WebGPU so it runs in a browser tab. On top of that it has the six looks of the Flashback app, 353 more film and era looks you can search, a camera mode that shoots through a look, and a 3D ONE35 V2 to turn around. There's nothing to install and no account. Your photos are never uploaded: everything happens on your device.

![The snowy field going through the five looks: Disposable, Point & Shoot, Rangefinder, Monochrome and Flashback Classic](docs/images/looks.webp)

<!-- live-links -->
**Live:** [gitguy268.github.io/flashnack](https://gitguy268.github.io/flashnack/) · [flashnack.vercel.app](https://flashnack.vercel.app)
<!-- /live-links -->

## Three steps

1. **Drop your photos** on the page, or click **Choose photos**. A whole folder works too.
2. **Pick a look.** Each card shows your photo in that look. Press `1` to `5` to switch.
3. **Export.** You get a zip of full-quality JPEGs. Click the tick on a frame in the film strip to leave a dud out.

Exposure, warmth and tint are per photo. **Use on every photo** copies them to the whole roll. **Fine-tune the look** has the film effects, and changes there apply to every photo in that look.

## Film looks

![The viaduct in Flashback Gold, with the Flashback app looks and the popular film looks on the right](docs/images/film-looks.webp)

Under the five LoFi Logic looks are three more rows:

- **Flashback app:** the six looks of the Flashback camera app: Gold, Classic, Dispo, Beta, Cine and Retro Haze.
- **Popular film:** Kodak Portra 400, Gold 200, Ultra Max 400, Ektar 100, Kodachrome 64 and Tri-X 400, Fuji Superia 400 and Velvia 50, Ilford HP5, Polaroid 600-type (PX-680) and 669, Valencia, and Flashnack's own Y2K Digicam, 80s Mall Flash, 90s Drugstore Print and Disposable 400.
- **More looks:** a search box over all 359 looks. Type a film (`portra`, `superia`), a decade (`60s`, `70s`, `80s`, `90s`, `y2k`, `2010s`), a kind (`polaroid`, `disposable`, `b&w`, `cinematic`) or a feel (`warm`, `faded`, `vivid`), or tap one of the chips. `eighties`, `1990s`, `bw` and `dispo` work too.

The Flashback app looks and the popular film looks come with the page and keep working offline once it has loaded. A look from the search is downloaded the first time you pick it and stays offline after that. **Look strength** blends a film look with the plain photo, and **Fine-tune the look** sets its grain, halation and the other effects.

<details>
<summary><b>Where the 359 looks come from</b></summary>

| Looks | Source | Licence |
|---|---|---|
| 6 Flashback app looks | The Flashback camera app, unchanged | Flashback's own work, not covered by the GPL |
| 51 film stocks (Portra, Gold, Superia, Velvia, Kodachrome, Tri-X, HP5…) | [t3mujinpack](https://github.com/t3mujin/t3mujinpack) by João Almeida | MIT |
| 264 film stocks with their variants, including about 120 Polaroid and Fuji instant films | Pat David's RawTherapee film simulation set, via [NatronGitHub/clut](https://github.com/NatronGitHub/clut) | CC BY-SA 4.0 |
| 26 Instagram-era filters (Valencia, Nashville, X-Pro II, 1977…) | Rendered from [CSSgram](https://github.com/una/CSSgram) by Una Kravets | MIT |
| 12 era looks (60s slide, 70s print, 80s, 90s, Y2K digicam, 2000s flash, disposable, instant, 2010s matte, teal and orange, tungsten night, newsprint) | Flashnack's own colour maths | GPL-3.0 |

The free decade packs we found don't allow sharing them, which is why the 60s to 2010s looks are Flashnack's own. All looks are stored as 64³ LUTs in PNG files and work on the finished (display) colours, after the tone curve, so they behave as they do in a phone app. `npm run luts:build` rebuilds them; [public/luts/LICENSES](public/luts/LICENSES/README.md) has the details.

![Searching for 80s: 38 looks, with 80s Mall Flash applied](docs/images/search.webp)
</details>

## Camera mode

<img src="docs/images/camera-mode.webp" alt="Camera mode: a black and yellow camera body with the live viewfinder in Flashback Gold, the look dial, the shutter, the exposure wheel and the winder" width="300" align="right">

**Shoot** opens the camera of your phone or laptop inside a Flashback-style body. The viewfinder shows the look live.

- **Look dial:** drag it, scroll on it or use `←` `→` to change the look.
- **Shutter:** the big round button, or `Space`.
- **Winder:** like the real camera, roll it (drag up, click it or press `W`) before the next frame.
- **Frame counter:** counts down from 27.
- **Flash switch:** turns on the phone's torch where the browser allows it, or a white screen flash with the front camera.
- **Exposure wheel:** from −2 to +2.
- **Flip:** switches between the front and back camera.
- **No screen:** hides the viewfinder, like the real thing.

**Develop** puts the photos on the roll in the editor, in the look you picked. The photos are taken without the look, so you can still change it there. Camera mode needs https or localhost, and asks for camera access the first time.
<br clear="right">

## The ONE35 V2 in 3D

![The ONE35 V2 model turning, black with the yellow band](docs/images/camera-3d.webp)

The start screen has a 3D ONE35 V2 that turns by itself. Click it for the full view, then:

- drag to turn it and scroll to zoom;
- press the shutter;
- slide the flash switch (the ready light on the back blinks while the flash charges);
- roll the winder to wind on.

It comes in all eight colours: black with yellow or orange, white with red, teal or pink, cream with coffee, and crystal with orange or teal. The crystal bodies show the battery and board inside. The model is built in code from published sizes and review photos. It is not an official model and leaves off Flashback's logo.

## What it opens

| Camera | File | How well |
|---|---|---|
| Flashback ONE35 V2 | `.dng` straight from the camera | The main target. Camera-matched colour, identical to LoFi Logic |
| Flashback ONE35 V1 | the negatives `.zip` from the Flashback app | Same colour matrix as LoFi Logic; Flashnack's own demosaic, so close but not identical (checked on a synthetic negative, not on a real V1 roll yet) |
| Other cameras | Canon, Nikon, Sony, Fujifilm and other RAWs, other DNGs | Best effort, through LibRaw, as in LoFi Logic. Colour is not calibrated per camera. Tested on one Sony ARW; lossy Apple ProRAW DNGs don't open |
| Any camera | `.jpg`, `.png` | Experimental, as in LoFi Logic. The look goes on top of the camera's own processing |

<details>
<summary><b>Getting the photos off the camera</b></summary>

**ONE35 V2:** plug the camera in over USB **before** you develop the roll in the Flashback app, and open the DNG files on it. Developing in the app first clears the DNGs off the camera.

**ONE35 V1:** develop the roll in the Flashback app, then in the gallery choose **Share → Export negatives**. Drop the `.zip` you get on Flashnack.

Flashback app: [iOS](https://apps.apple.com/app/flashback-camera/id1601362087) · [Android](https://play.google.com/store/apps/details?id=co.joinflashback.android)
</details>

<!-- run-steps:start -->
## Run it locally, step by step

1. **Install [Node.js](https://nodejs.org) 20** or newer.

2. **Get the code:**

   ```sh
   git clone https://github.com/Gitguy268/flashnack.git
   cd flashnack
   ```

3. **Install and build:**

   ```sh
   npm ci
   npm run build
   ```

   On a Mac you can double-click `start.command` instead of steps 3 to 5.

4. **Start it:**

   ```sh
   npx vite preview --port 5292
   ```

5. **Open <http://localhost:5292/>** in your browser. Press `Ctrl+C` to stop.
<!-- run-steps:end -->

Opening `index.html` straight from the folder doesn't work, because browsers block the app's workers on `file://` pages. The page says so and points you to `start.command`.

## Controls

| Input | Action |
|---|---|
| `1` to `5` | Pick one of the five LoFi Logic looks |
| `←` / `→` | Previous / next photo |
| Hold `Space`, or hold **Hold to compare** | See the photo without the look |
| `R` | Rotate 90° |
| Scroll, double-click | Zoom, fit / 100% |
| Drag (when zoomed) | Pan |
| `Cmd`/`Ctrl` + `C`, then `V` | Copy this photo's settings, paste on another |
| Double-click a slider | Reset it |
| `Z` | Full screen ("zen mode") |

In camera mode: `Space` takes a photo, `W` winds on, `F` switches the flash, `←` `→` turn the look dial and `Esc` develops the roll.

In full screen, drag up or down for exposure, left or right for warmth and right-drag for tint. The arrow keys move between photos (`↑`/`↓` rotate), and `Esc` leaves.

<details>
<summary><b>Phones</b></summary>

Flashnack works at phone width: the looks scroll sideways and the film strip stays at the bottom. Use **Choose photos** to pick files. Phones with WebGPU render on the GPU; others use the slower CPU renderer. Only phone-sized desktop browsers have been tested so far, not real phones.

<img src="docs/images/phone.webp" alt="Flashnack on a phone: the snowy field in the Disposable look, the looks below it and the film strip at the bottom" width="300">
</details>

## How it works

Every photo is developed once into a linear [ACEScg](https://acescentral.com) image at half size (2072 px on the long edge for a V2 DNG), with halation baked in. Every slider move then renders that image again on the GPU:

```
DNG (10-bit RGGB)  ->  2x2 bin  ->  highlight recovery  ->  ForwardMatrix  ->  ACEScg  (+ halation)
ACEScg  ->  exposure · white balance · tint · push/pull
        ->  vignette -> bloom -> chroma noise reduction        (linear light)
        ->  ACEScct -> 65³ 3D LUT, tetrahedral                  (the five LoFi Logic looks)
            or tone curve -> sRGB -> 64³ film look LUT          (Flashback app, film and era looks)
        ->  colour fringing -> softness -> grain -> sharpen     (display)
        ->  JPEG
```

The decode runs in a Web Worker. The render runs in WebGPU compute shaders, ported unchanged from LoFi Logic's WGSL. In browsers without WebGPU the same stages run in JavaScript, in a second worker. That is slower, so the preview shows a half-size draft while you drag and the full render once you stop.

<details>
<summary><b>Checked against the desktop app</b></summary>

The port is tested pixel for pixel against LoFi Logic's own code (`core.processor`, its GPU path, grain off) on four ONE35 V2 DNGs:

| Stage | Largest difference (0 to 1 scale) |
|---|---|
| Raw unpack | 0, bit-exact with rawpy |
| Half-size binning | 0, bit-exact with rawpy |
| Develop with halation | 7 × 10⁻⁷ |
| Final render, all five looks, WebGPU | 1 × 10⁻⁵ |
| Final render, CPU renderer (2 DNGs) | 2 × 10⁻⁴ |
| V1 negative develop (synthetic negative) | mean 2 × 10⁻³, sharp edges up to 0.2 (different demosaic) |
| Sony ARW through LibRaw, Disposable look | mean 4 × 10⁻³ on the exported JPEG |

One 8-bit level is 4 × 10⁻³, so for V2 DNGs the rendered pixels are the desktop app's. The JPEG files themselves differ slightly, because Flashnack encodes with MozJPEG and the desktop app with Pillow. Grain is the exception: both apps place the same grain tiles at random, so grain differs between any two exports. CONTRIBUTING.md has the steps to rerun the check.
</details>

<details>
<summary><b>What the desktop app has and Flashnack doesn't</b></summary>

- **USB import from the camera.** Browsers can't talk to the camera; open the files from it instead.
- **DNG export**, the F12 LUT-profiling panel, reverse auto-exposure and `.lofi` project files.
- **Your own `.cube` LUTs.** (The 359 film looks are built in, but you can't add your own yet.)
- **Auto tint** (the WB-linked tint toggle).

Settings you change in **Fine-tune the look** and the look you picked are remembered in this browser. After the first visit the app works offline (the browser keeps the app, the popular looks and the samples). Photos and per-photo settings are not: reloading the page starts an empty roll.
</details>

## Licence and credits

Flashnack is [GPL-3.0](LICENSE), the same licence as LoFi Logic, which it is ported from. The colour pipeline, shaders, LUTs, grain textures and look settings come from [lofilogic/flashback-raw-editor](https://github.com/lofilogic/flashback-raw-editor), and each ported file names its source. The film looks have their own sources and licences (see [Where the 359 looks come from](#film-looks)); the six Flashback app looks are Flashback's and not covered by the GPL. [NOTICE](NOTICE) lists everything, with the bundled libraries: fflate (MIT), @jsquash/jpeg with MozJPEG (Apache-2.0), libraw-wasm with LibRaw (ISC, LGPL-2.1/CDDL), three.js (MIT) and the Archivo font (OFL-1.1).

Flashnack is an independent project. It is not made by or affiliated with LoFi Logic or Flashback.
