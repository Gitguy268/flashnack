"""Reference renders from upstream LoFi Logic for Flashnack parity checks.

Usage: python make-reference.py <upstream clone> <out dir> photo.dng [...]
Runs the desktop app's core.processor (GPU path) with grain off and writes
raw, half-size, develop and per-look render arrays as float32 .bin files.
The six upstream .cube LUTs must be in a luts/ folder next to the clone.
"""
import sys, os, json
UP = sys.argv[1]; OUT = sys.argv[2]; DNGS = sys.argv[3:]
sys.path.insert(0, UP)
import numpy as np, rawpy
from core import processor as P
from core.config import VibeConfig, ImageAdjustments, vibe_config_for, VIBE_PRESETS, FACTORY_LUTS
from core.gpu import HAS_GPU
import colour
print("HAS_GPU", HAS_GPU)
# Point factory LUT paths at the downloaded cubes.
LUTDIR = os.path.join(os.path.dirname(UP), 'luts')
import core
core.resource_path = lambda rel: os.path.join(LUTDIR, os.path.basename(rel)) if rel.startswith('assets/luts') else os.path.join(UP, rel)
import core.config as C
C.resource_path = core.resource_path
P.resource_path = core.resource_path

meta = {}
for d in DNGS:
    name = os.path.splitext(os.path.basename(d))[0]
    with rawpy.imread(d) as raw:
        ri = raw.raw_image_visible.astype(np.uint16)
        ri.tofile(f"{OUT}/{name}_raw_u16.bin")
        meta[name] = {'raw_shape': ri.shape, 'white': int(raw.white_level), 'black': list(map(int, raw.black_level_per_channel))}
        rgb = raw.postprocess(demosaic_algorithm=rawpy.DemosaicAlgorithm.LINEAR, user_wb=[1.0]*4,
            use_camera_wb=False, use_auto_wb=False, user_black=64, half_size=True, no_auto_bright=True,
            bright=1.0, highlight_mode=1, gamma=(1, 1), output_bps=16, output_color=rawpy.ColorSpace.raw)
        rgb.astype(np.uint16).tofile(f"{OUT}/{name}_half_u16.bin")
        meta[name]['half_shape'] = rgb.shape
    for vid in VIBE_PRESETS:
        v = vibe_config_for(vid)
        v.enable_grain = False   # random; compared separately
        p = P.FlashbackProcessor(vibe=v, adjustments=ImageAdjustments())
        from core.gpu import gpu as G
        G.upload_lut(p.lut.table)
        p.load_image(d)
        if vid == 'disposable':
            p.intermediate_acescg.astype(np.float32).tofile(f"{OUT}/{name}_{vid}_inter_f32.bin")
            meta[name]['inter_shape'] = p.intermediate_acescg.shape
        out = p.render_export()
        out.astype(np.float32).tofile(f"{OUT}/{name}_{vid}_render_f32.bin")
        from PIL import Image
        Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(f"{OUT}/{name}_{vid}.png")
        print(name, vid, out.shape, float(out.mean()))
    # No-halation intermediate too, to test develop alone.
    v = VibeConfig(); v.enable_halation = False
    p = P.FlashbackProcessor(vibe=v); p.load_image(d)
    p.intermediate_acescg.astype(np.float32).tofile(f"{OUT}/{name}_develop_f32.bin")
json.dump(meta, open(f"{OUT}/meta.json", "w"), indent=1, default=list)
