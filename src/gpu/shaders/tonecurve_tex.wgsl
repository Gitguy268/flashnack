// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Render path without a LUT, from LoFi Logic processor._render:
// ACEScg -> ProPhoto, clip, profile tone curve, -> linear sRGB, clip, sRGB OETF.
// Matrices are applied as row vector @ M, like the numpy code.
// Ported 2026-11-09 by Lucas Van De Weerd.

struct U {
    a2p0: vec4f, a2p1: vec4f, a2p2: vec4f,   // ACESCG_TO_PROPHOTO rows
    p2s0: vec4f, p2s1: vec4f, p2s2: vec4f,   // PROPHOTO_TO_LINSRGB rows
}

@group(0) @binding(0) var               src:   texture_2d<f32>;
@group(0) @binding(1) var<storage, read> curve: array<f32>;
@group(0) @binding(2) var               dst:   texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var<uniform>      u:     U;

fn rowvec(v: vec3f, r0: vec3f, r1: vec3f, r2: vec3f) -> vec3f {
    return v.x * r0 + v.y * r1 + v.z * r2;
}

fn tone(x: f32) -> f32 {
    let n = arrayLength(&curve);
    let i = u32(clamp(x * f32(n - 1u), 0.0, f32(n - 1u)));
    return curve[i];
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
    let c = textureLoad(src, p, 0).rgb;
    var pp = clamp(rowvec(c, u.a2p0.xyz, u.a2p1.xyz, u.a2p2.xyz), vec3f(0.0), vec3f(1.0));
    pp = vec3f(tone(pp.x), tone(pp.y), tone(pp.z));
    let lin = clamp(rowvec(pp, u.p2s0.xyz, u.p2s1.xyz, u.p2s2.xyz), vec3f(0.0), vec3f(1.0));
    textureStore(dst, p, vec4f(oetf(lin.x), oetf(lin.y), oetf(lin.z), 1.0));
}
