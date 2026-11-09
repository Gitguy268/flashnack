// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Per-channel linear gain: exposure * white balance * tint, as in LoFi Logic
// processor._render (img * gain). New shader written 2026-11-09 for Flashnack.

struct U { gain: vec3f, _p: f32, }

@group(0) @binding(0) var          src: texture_2d<f32>;
@group(0) @binding(1) var          dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> u:   U;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(src);
    if gid.x >= dims.x || gid.y >= dims.y { return; }
    let p = vec2i(i32(gid.x), i32(gid.y));
    textureStore(dst, p, vec4f(textureLoad(src, p, 0).rgb * u.gain, 1.0));
}
