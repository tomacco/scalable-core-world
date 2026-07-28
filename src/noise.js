// Seeded value noise. Deterministic: every visitor sees the same planet.

export function makeNoise(seed = 20260728) {
  function hash(x, y, z) {
    let h = (x * 374761393 + y * 668265263 + z * 1274126177 + seed * 144665) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  const smooth = (t) => t * t * (3 - 2 * t);

  function noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = smooth(xf), v = smooth(yf), w = smooth(zf);

    const lerp = (a, b, t) => a + (b - a) * t;
    const c000 = hash(xi, yi, zi),     c100 = hash(xi + 1, yi, zi);
    const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
    const c001 = hash(xi, yi, zi + 1),     c101 = hash(xi + 1, yi, zi + 1);
    const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);

    return lerp(
      lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
      lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
      w
    );
  }

  function fbm(x, y, z, octaves = 4) {
    let sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.13;
    }
    return sum / norm;
  }

  return { hash, noise3, fbm };
}
