// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Rotate by 90/180/270 degrees clockwise (np.rot90 in LoFi Logic
// processor._apply_rotation_and_render). New shader written 2026-11-09.

struct U { quarter: u32, _p0: u32, _p1: u32, _p2: u32, }

@group(0) @binding(0) var          src: texture_2d<f32>;
@group(0) @binding(1) var          dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> u:   U;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let od = textureDimensions(dst);
    if gid.x >= od.x || gid.y >= od.y { return; }
    let sd = vec2i(textureDimensions(src));
    let x = i32(gid.x);
    let y = i32(gid.y);
    var s: vec2i;
    if u.quarter == 1u {        // 90 clockwise
        s = vec2i(y, sd.y - 1 - x);
    } else if u.quarter == 2u { // 180
        s = vec2i(sd.x - 1 - x, sd.y - 1 - y);
    } else if u.quarter == 3u { // 270 clockwise
        s = vec2i(sd.x - 1 - y, x);
    } else {
        s = vec2i(x, y);
    }
    textureStore(dst, vec2i(x, y), textureLoad(src, s, 0));
}
