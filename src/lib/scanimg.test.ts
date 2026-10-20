import { describe, it, expect } from 'vitest';
import { measure, enhance } from './scanimg';

function frame(values: number[]): Uint8ClampedArray {            // grayscale pixels -> RGBA
  const d = new Uint8ClampedArray(values.length * 4);
  values.forEach((v, i) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; });
  return d;
}
const gray = (d: Uint8ClampedArray, i: number) => d[i * 4];

describe('scanner image helpers', () => {
  it('flags a dark, low-contrast frame as weak and a good frame as fine', () => {
    const dark = frame(Array.from({ length: 4000 }, (_, i) => 20 + (i % 3) * 15));       // 20..50
    const good = frame(Array.from({ length: 4000 }, (_, i) => (i % 3 ? 235 : 15)));      // strong black/white
    expect(measure(dark).weak).toBe(true);
    expect(measure(good).weak).toBe(false);
  });
  it('stretches a dark frame so bars and spaces end up far apart', () => {
    const d = frame(Array.from({ length: 4000 }, (_, i) => (i % 3 ? 50 : 20)));
    enhance(d);
    expect(gray(d, 1) - gray(d, 0)).toBeGreaterThan(150);
  });
  it('brightens the light parts of a dark frame', () => {
    const d = frame(Array.from({ length: 4000 }, (_, i) => (i % 3 ? 60 : 25)));
    enhance(d);
    expect(gray(d, 1)).toBeGreaterThan(200);
  });
  it('does not blow up a completely flat frame', () => {
    const d = frame(new Array(4000).fill(10));
    expect(() => enhance(d)).not.toThrow();
    expect(gray(d, 0)).toBeLessThan(10 + 1);
  });
});
