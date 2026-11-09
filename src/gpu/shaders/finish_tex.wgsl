// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// End of LoFi Logic processor._render: undo the pre-LUT exposure in linear
// light (post_gain = 2^-pre_lut_ev) and clip to 0..1. With post_gain == 1
// it only clips. Ported 2026-11-09 by Lucas Van De Weerd.

struct U { post_gain: f32, apply: f32, _p0: f32, _p1: f32, }

@group(0) @binding(0) var          src: texture_2d<f32>;
@group(0) @binding(1) var          dst: texture_storage_2d<rgba32float, write>;
@group(0) @binding(2) var<uniform> u:   U;

fn eotf(x: f32) -> f32 {
    let c = clamp(x, 0.0, 1.0);
    if c <= 0.04045 { return c / 12.92; }
    return pow((c + 0.055) / 1.055, 2.4);
}
fn oetf(x: f32) -> f32 {
    let c = clamp(x, 0.0, 1.0);
    if c <= 0.0031308 { return 12.92 * c; }
    return 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let dims = textureDimensions(src);
    if gid.x >= dims.x || gid.y >= dims.y { return; }
    let p = vec2i(i32(gid.x), i32(gid.y));
    var c = textureLoad(src, p, 0).rgb;
    if u.apply > 0.5 {
        c = vec3f(oetf(eotf(c.x) * u.post_gain), oetf(eotf(c.y) * u.post_gain), oetf(eotf(c.z) * u.post_gain));
    }
    textureStore(dst, p, vec4f(clamp(c, vec3f(0.0), vec3f(1.0)), 1.0));
}
