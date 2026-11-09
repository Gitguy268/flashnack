// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Builds the grain layer from the film-grain tiles: the frame is covered by
// tiles on a grid, each a random tile, randomly flipped. Same idea as LoFi Logic
// processor._generate_grain_layer, which does it on the CPU with numpy's RNG;
// this version hashes (seed, cell) so the grain stays put while you edit.
// New shader written 2026-11-09.

struct U { seed: u32, tiles: u32, cell_w: u32, cell_h: u32, src_w: u32, src_h: u32, _p0: u32, _p1: u32, }

@group(0) @binding(0) var          tiles: texture_2d_array<f32>;
@group(0) @binding(1) var          dst:   texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> u:     U;

fn hash(v: u32) -> u32 {
    var x = v;
    x ^= x >> 16u; x *= 0x7feb352du;
    x ^= x >> 15u; x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(dst);
    if gid.x >= dims.x || gid.y >= dims.y { return; }
    let cx = gid.x / u.cell_w;
    let cy = gid.y / u.cell_h;
    let r = hash(u.seed ^ hash((cx * 73856093u) ^ (cy * 19349663u)));
    let idx = r % max(u.tiles, 1u);
    var tx = gid.x % u.cell_w;
    var ty = gid.y % u.cell_h;
    if (r & 0x100u) != 0u { tx = u.cell_w - 1u - tx; }
    if (r & 0x200u) != 0u { ty = u.cell_h - 1u - ty; }
    // Nearest resample when the cell is a scaled tile (non-Flashback sizes).
    tx = min(tx * u.src_w / u.cell_w, u.src_w - 1u);
    ty = min(ty * u.src_h / u.cell_h, u.src_h - 1u);
    let g = textureLoad(tiles, vec2i(i32(tx), i32(ty)), i32(idx), 0).rgb;
    textureStore(dst, vec2i(i32(gid.x), i32(gid.y)), vec4f(g, 1.0));
}
