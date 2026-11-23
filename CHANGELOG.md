# Changelog

## 0.2.0 (2026-11-23)

- **Film looks:** the six Flashback app looks (Gold, Classic, Dispo, Beta, Cine, Retro Haze), 16 popular film and era looks, and a search over 359 looks with decade, kind and feel words (`y2k`, `80s`, `polaroid`, `b&w`…) and chips. Sources: t3mujinpack (MIT), Pat David's RawTherapee set (CC BY-SA 4.0), CSSgram (MIT) and Flashnack's own era looks. Film looks run after the tone curve on display colours, with a strength slider.
- **Offline:** a service worker keeps the app, the Flashback and popular looks and the samples after the first visit; other looks are kept once used.
- **Camera mode:** shoot with the device camera through a Flashback-style body: live look preview, look dial, winder, 27-frame counter, flash switch (torch or screen flash), exposure wheel, front/back camera and a no-screen mode. Shots join the roll.
- **3D ONE35 V2:** a model built in code that turns on the start screen; the full view has a working shutter, flash switch with ready light, winder, LCD counter and all eight colours.
- The five LoFi Logic looks render exactly as in 0.1.0.

## 0.1.0 (2026-11-09)

First version.

- Opens Flashback ONE35 V2 DNGs, V1 negative zips (or loose negatives), other RAWs through LibRaw, and JPEG/PNG.
- The five LoFi Logic looks with its full effect stack, rendered in WebGPU; matches the desktop app to within 1e-5 on V2 DNGs.
- CPU renderer in a worker for browsers without WebGPU.
- Exposure, warmth, tint and push/pull per photo; fine-tune sliders per look, remembered in the browser.
- Film strip with skip ticks, hold to compare, zoom and pan, rotate, copy and paste settings, zen mode with drag gestures.
- Export to a zip of JPEGs (quality 95) with LoFi Logic's file names.
- Two sample photos to try it without your own.
