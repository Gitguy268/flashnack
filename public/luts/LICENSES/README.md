# Where the film look LUTs come from

Every file in `public/luts/look/` is a 64³ LUT stored as a 512 × 512 PNG of
8 × 8 tiles (red across each tile, green down, blue from tile to tile).
`scripts/build-luts.mjs` makes them; the file name prefix says where each one
comes from.

| Prefix | Source | Licence |
|---|---|---|
| `fb-` | The six looks of the Flashback camera app (Gold, Classic, Dispo, Beta, Cine, Retro Haze), copied unchanged | Flashback's own work. Not Flashnack's and not covered by Flashnack's GPL licence |
| `t3-` | [t3mujinpack](https://github.com/t3mujin/t3mujinpack) by João Almeida, HaldCLUTs resampled from 144³ to 64³ | MIT, see `t3mujinpack-MIT.txt` |
| `rt-` | The RawTherapee film simulation HaldCLUTs by Pat David (with Pavlov Dmitry and Michael Ezra), from the [NatronGitHub/clut](https://github.com/NatronGitHub/clut) collection (folders bw, colorslide, instant_consumer, instant_pro, negative_color, negative_new, negative_old), rearranged into tiles | CC BY-SA 4.0, as stated by that collection, https://creativecommons.org/licenses/by-sa/4.0/ . The converted files are shared under the same licence |
| `ig-` | Rendered from the CSS filters of [CSSgram](https://github.com/una/CSSgram) by Una Kravets (`scripts/render-cssgram.mjs`); gradient overlays replaced by their centre colour | MIT, see `CSSgram-MIT.txt` |
| `own-` | Flashnack's own era looks (`scripts/era-looks.mjs`) | GPL-3.0, like the rest of Flashnack |

Film and brand names (Kodak, Fujifilm, Ilford, Agfa, Polaroid, Rollei, Lomography, Instagram filter names and others) appear only to say which film or filter a LUT aims to look like. Neither Flashnack nor the LUT authors are affiliated with or endorsed by the owners of those trademarks.
