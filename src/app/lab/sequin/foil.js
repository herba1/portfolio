// The mirror side is not a photograph. It is a sequin picture: a bag of a
// few stock foils, and each sequin sewn on is one of them, chosen the way a
// maker would, by error diffusion across the swatch. Each foil's colour is its
// reflectance (F0, linear): what it gives back of a softbox.

export const FOILS = [
  { name: "black", f0: [0.014, 0.014, 0.017] },
  { name: "gunmetal", f0: [0.07, 0.074, 0.082] },
  { name: "pewter", f0: [0.24, 0.245, 0.25] },
  { name: "bottle green", f0: [0.03, 0.13, 0.055] },
  { name: "teal", f0: [0.06, 0.4, 0.42] },
  { name: "royal blue", f0: [0.035, 0.075, 0.38] },
  { name: "champagne", f0: [0.62, 0.48, 0.28] },
  { name: "silver", f0: [0.66, 0.67, 0.69] },
];

// Linear sRGB to Oklab.
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675778 * s,
  ];
}

// Floyd-Steinberg on the sequins' own lattice. `rows` is a list of rows, top
// to bottom, each a list of disc indices left to right; odd rows sit half a
// disc to the right, between the two discs of the row above. `target(i)` is
// the linear colour the cover asks for at disc i. Rows are walked serpentine,
// and a disc's error goes to the one ahead of it in its row and the two it
// touches in the row below. Returns each disc's foil index.
export function ditherFoils(rows, N, target, { foils = FOILS, chroma = 1, lWeight = 2, levels = [0.02, 0.99], gamma = 0.85, cap = 0.18 } = {}) {
  const pal = foils.map((f) => oklab(f.f0));
  const Lmin = Math.min(...pal.map((p) => p[0]));
  const Lmax = Math.max(...pal.map((p) => p[0]));
  const lab = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) lab.set(oklab(target(i)), i * 3);
  // The cover's tones are stretched onto the bag's, the way a maker sets
  // levels before picking foils: its darkest few percent are the black
  // foil, its brightest few the silver, so a white stripe is sewn in silver
  // and not in the champagne just under it.
  const Ls = Array.from({ length: N }, (_, i) => lab[i * 3]).sort((a, b) => a - b);
  const lo = Ls[Math.floor(levels[0] * (N - 1))], hi = Ls[Math.floor(levels[1] * (N - 1))];
  const want = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const t = Math.pow(Math.min(1, Math.max(0, (lab[i * 3] - lo) / Math.max(1e-3, hi - lo))), gamma);
    want[i * 3] = Lmin + (Lmax - Lmin) * t;
    // Colour is asked for only once there is light to carry it: a near-black
    // target asks for black foil, not a sprinkle of blue and green that
    // averages to black.
    const k = chroma * smooth(0.12, 0.45, t);
    want[i * 3 + 1] = lab[i * 3 + 1] * k;
    want[i * 3 + 2] = lab[i * 3 + 2] * k;
  }
  const err = new Float32Array(N * 3);
  const out = new Uint8Array(N);
  const push = (j, w, e0, e1, e2) => {
    if (j < 0) return;
    err[j * 3] += e0 * w;
    err[j * 3 + 1] += e1 * w;
    err[j * 3 + 2] += e2 * w;
  };
  // Carried error is held to a bound, so a run of one colour the bag can't
  // make never builds into a streak.
  const CAP = cap;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const below = rows[r + 1] || null;
    const shifted = (r & 1) === 1;
    const rev = (r & 1) === 1;
    const n = row.length;
    for (let k = 0; k < n; k++) {
      const c = rev ? n - 1 - k : k;
      const i = row[c];
      const L = want[i * 3] + clampE(err[i * 3], CAP);
      const A = want[i * 3 + 1] + clampE(err[i * 3 + 1], CAP);
      const B = want[i * 3 + 2] + clampE(err[i * 3 + 2], CAP);
      let best = 0, bd = Infinity;
      for (let p = 0; p < pal.length; p++) {
        const dl = (L - pal[p][0]) * lWeight, da = A - pal[p][1], db = B - pal[p][2];
        const d = dl * dl + da * da + db * db;
        if (d < bd) { bd = d; best = p; }
      }
      out[i] = best;
      const e0 = L - pal[best][0], e1 = A - pal[best][1], e2 = B - pal[best][2];
      // Ahead in the row.
      const ahead = rev ? c - 1 : c + 1;
      if (ahead >= 0 && ahead < n) push(row[ahead], 7 / 16, e0, e1, e2);
      if (!below) continue;
      // The two below, touching: for an unshifted row they are c-1 and c of
      // the next; for a shifted one, c and c+1.
      const lo = shifted ? c : c - 1, hi = lo + 1;
      const back = rev ? hi : lo, fwd = rev ? lo : hi;
      const m = below.length;
      if (back >= 0 && back < m) push(below[back], 5 / 16, e0, e1, e2);
      if (fwd >= 0 && fwd < m) push(below[fwd], 4 / 16, e0, e1, e2);
    }
  }
  return out;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clampE = (e, c) => (e > c ? c : e < -c ? -c : e);
