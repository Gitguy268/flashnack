import { describe, it, expect } from 'vitest';
import { planckianXyz, kelvinToAcescgGain, acescctEncode, acescctDecode, matmul3, XYZ_D50_TO_ACESCG, FM1_WB_TO_ACESCG } from '../../src/color.js';
import { gaussKernel, pyRound } from '../../src/gpu/kernels.js';
import { parseCube, cubeToTable } from '../../scripts/convert-luts.mjs';
import { exportBasename, uniqueNames } from '../../src/library.js';

// Values printed by upstream LoFi Logic (colour-science 0.4.4) on 2026-11-09.
describe('colour maths', () => {
  it('Planckian XYZ matches upstream', () => {
    expect(planckianXyz(5500)[0]).toBeCloseTo(0.9565428495, 5);
    expect(planckianXyz(5500)[2]).toBeCloseTo(0.9202635884, 5);
    expect(planckianXyz(3000)[2]).toBeCloseTo(0.394004643, 5);
  });
  it('white balance gain matches upstream', () => {
    const g = kelvinToAcescgGain(6504);
    expect(g[0]).toBeCloseTo(1.0588235855, 5);
    expect(g[2]).toBeCloseTo(0.8521002531, 5);
    expect(kelvinToAcescgGain(2000)[2]).toBeCloseTo(4.7207016945, 4);
  });
  it('ACEScct round-trips', () => {
    for (const v of [0.001, 0.0078125, 0.18, 1, 16]) expect(acescctDecode(acescctEncode(v))).toBeCloseTo(v, 6);
  });
  it('FM1 develop matrix is XYZ_D50_TO_ACESCG @ FM1', () => {
    const FM1 = [[0.53086, 0.22116, 0.21219], [0.0857, 0.9893, -0.075], [0.04526, -0.37228, 1.15192]];
    const m = matmul3(XYZ_D50_TO_ACESCG, FM1);
    m.forEach((r, i) => r.forEach((v, j) => expect(v).toBeCloseTo(FM1_WB_TO_ACESCG[i][j], 5)));
  });
});

describe('kernels', () => {
  it('rounds half to even like Python', () => {
    expect([0.5, 1.5, 2.5, 3.5].map(pyRound)).toEqual([0, 2, 2, 4]);
  });
  it('Gaussian kernel is normalised with radius round(3 sigma)', () => {
    const k = gaussKernel(0.5);
    expect(k.length).toBe(5); // round(1.5) = 2
    expect(k.reduce((a, b) => a + b)).toBeCloseTo(1, 6);
  });
});

describe('LUT conversion', () => {
  it('reorders .cube (red fastest) into [r][g][b]', () => {
    const lines = ['LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g * 0.5} ${b * 0.25}`);
    const { table } = cubeToTable(parseCube(lines.join('\n')));
    // entry (r=1, g=0, b=1)
    const i = ((1 * 2 + 0) * 2 + 1) * 3;
    expect([table[i], table[i + 1], table[i + 2]]).toEqual([65535, 0, Math.round(0.25 * 65535)]);
  });
});

describe('export names', () => {
  it('follows upstream naming', async () => {
    expect(await exportBasename({ name: 'SN1234_42.dng', kind: 'v2' })).toBe('FBV2_00042');
    expect(await exportBasename({ name: 'IMG_1.jpg', kind: 'image', isJpeg: true })).toBe('IMG_1_jpg');
    expect(await exportBasename({ name: 'x.dng', kind: 'v2' })).toBe('x');
    expect((await exportBasename({ kind: 'v1', roll: 'roll-a', negative: { name: '7' } })).match(/^FBV1_[0-9a-f]{4}_00007$/)).not.toBeNull();
    expect(uniqueNames(['a.jpg', 'a.jpg', 'b.jpg'])).toEqual(['a.jpg', 'a-2.jpg', 'b.jpg']);
  });
});
