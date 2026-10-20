const SS = 4;

export function createRaster({ rows, fontPx, baseline, spacing, family }) {
  const cache = new Map();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const font = `500 ${fontPx * SS}px ${family}`;

  const advance = (ch) => {
    ctx.font = font;
    return ctx.measureText(ch).width / SS;
  };

  const glyph = (ch) => {
    if (cache.has(ch)) return cache.get(ch);
    const adv = advance(ch);
    const cols = Math.max(1, Math.round(adv + spacing));
    const data = new Float32Array(cols * rows);
    if (ch.trim()) {
      const w = cols * SS;
      const h = rows * SS;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.font = font;
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(ch, (spacing * SS) / 2, baseline * SS);
      const px = ctx.getImageData(0, 0, w, h).data;
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          let sum = 0;
          for (let y = 0; y < SS; y += 1) {
            const row = (r * SS + y) * w;
            for (let x = 0; x < SS; x += 1) sum += px[(row + c * SS + x) * 4 + 3];
          }
          data[c * rows + r] = Math.pow(sum / (SS * SS * 255), 0.85);
        }
      }
    }
    const built = { data, cols };
    cache.set(ch, built);
    return built;
  };

  const line = (text) => {
    const parts = [...text].map(glyph);
    const cols = parts.reduce((s, p) => s + p.cols, 0);
    const data = new Float32Array(cols * rows);
    let at = 0;
    for (const p of parts) {
      data.set(p.data, at * rows);
      at += p.cols;
    }
    return { data, cols };
  };

  const gap = (seconds, colRate) => {
    const cols = Math.max(1, Math.round(seconds * colRate));
    return { data: new Float32Array(cols * rows), cols };
  };

  return { glyph, line, gap };
}
