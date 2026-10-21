/** Image helpers for the barcode scanner (pure, testable without a camera). */

export interface FrameStats { mean: number; lo: number; hi: number; weak: boolean }

/** Measures a frame (RGBA data): average brightness and the usable brightness range (1st..99th percentile). */
export function measure(d: Uint8ClampedArray | Uint8Array): FrameStats {
  const hist = new Uint32Array(256); let n = 0, sum = 0;
  for (let i = 0; i < d.length; i += 16) {                  // sample every 4th pixel: fast on big frames
    const y = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    hist[y]++; sum += y; n++;
  }
  if (!n) return { mean: 128, lo: 0, hi: 255, weak: false };
  const cut = (p: number) => { let acc = 0; const t = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
  const lo = cut(0.01), hi = cut(0.99), mean = sum / n;
  return { mean, lo, hi, weak: mean < 90 || mean > 170 || hi - lo < 150 };   // dark, overexposed or flat (low contrast) frame
}

/**
 * Turns a dark / washed-out frame into a clear black-and-white-friendly gray image, in place:
 * stretches the usable range to 0..255 and brightens dark frames. Returns the stats it measured.
 */
export function enhance(d: Uint8ClampedArray): FrameStats {
  const s = measure(d);
  const lo = s.lo, hi = Math.max(s.hi, s.lo + 24);           // never divide by a tiny range (would only amplify noise)
  const gamma = s.mean < 90 ? Math.max(0.5, 0.5 + s.mean / 225) : s.mean > 170 ? Math.min(2.2, 1 + (s.mean - 170) / 50) : 1;   // dark -> brighten, overexposed -> darken
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) { const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))); lut[v] = Math.round(255 * Math.pow(t, gamma)); }
  for (let i = 0; i < d.length; i += 4) {
    const y = lut[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8];
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  return s;
}
