// Flashnack - SPDX-License-Identifier: GPL-3.0-only
// Draws the rendered frame (display sRGB in an rgba32float texture) onto the
// canvas with zoom and pan. Bilinear by hand, since f32 isn't filterable.
// New shader written 2026-11-09.

struct U {
    // canvas px -> image px: img = canvas * scale + offset
    scale:  vec2f,
    offset: vec2f,
    canvas: vec2f,
    bg:     vec2f,   // x = background grey (0..1)
}

@group(0) @binding(0) var          img: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u:   U;

struct VOut { @builtin(position) pos: vec4f, }

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
    var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    var o: VOut;
    o.pos = vec4f(p[i], 0.0, 1.0);
    return o;
}

fn load(p: vec2i, d: vec2i) -> vec3f {
    return textureLoad(img, clamp(p, vec2i(0), d - vec2i(1)), 0).rgb;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
    let dims = vec2f(textureDimensions(img));
    let ip = v.pos.xy * u.scale + u.offset - vec2f(0.5);
    if ip.x < -0.5 || ip.y < -0.5 || ip.x > dims.x - 0.5 || ip.y > dims.y - 0.5 {
        return vec4f(vec3f(u.bg.x), 1.0);
    }
    let d = vec2i(dims);
    let p0 = floor(ip);
    let f = ip - p0;
    let i0 = vec2i(p0);
    let c = mix(mix(load(i0, d), load(i0 + vec2i(1, 0), d), f.x),
                mix(load(i0 + vec2i(0, 1), d), load(i0 + vec2i(1, 1), d), f.x), f.y);
    return vec4f(c, 1.0);
}
