const TILE = [237, 244, 242];
const INLAY = [22, 52, 84];

function hash(i, j) {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function markingLayout({ width, height, text, family, measure }) {
  const narrow = width < 640;
  const probe = 100;
  measure.font = `600 ${probe}px ${family}`;
  const w = Math.max(1, measure.measureText(text || " ").width);
  const maxW = width * (narrow ? 0.84 : 0.6);
  const maxSize = Math.min(height * (narrow ? 0.16 : 0.27), narrow ? 112 : 260);
  const size = Math.max(36, Math.min(maxSize, (probe * maxW) / w));
  measure.font = `600 ${size}px ${family}`;
  const textW = measure.measureText(text || " ").width;
  const baseline = height * (narrow ? 0.66 : 0.68) + size * 0.34;
  const left = (width - textW) / 2;
  return { size, baseline, left, width: textW };
}

export function caretPoint(layout, text, family, measure) {
  measure.font = `600 ${layout.size}px ${family}`;
  const w = measure.measureText(text).width;
  return [layout.left + w, layout.baseline - layout.size * 0.36];
}

export function paintFloor(canvas, { width, height, scale, text, family }) {
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const tile = Math.max(18, Math.min(30, Math.min(width, height) / 26));
  const grout = Math.max(1.2, tile * 0.075);
  const ox = ((width / 2) % tile) - tile;
  const oy = ((height * 0.68) % tile) - tile;
  const cols = Math.ceil((width - ox) / tile) + 1;
  const rows = Math.ceil((height - oy) / tile) + 1;

  ctx.fillStyle = `rgb(${TILE[0]} ${TILE[1]} ${TILE[2]})`;
  ctx.fillRect(0, 0, width, height);

  const layout = markingLayout({ width, height, text, family, measure: ctx });
  ctx.font = `600 ${layout.size}px ${family}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = `rgb(${INLAY[0]} ${INLAY[1]} ${INLAY[2]})`;
  ctx.fillText(text, layout.left, layout.baseline);

  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = ox + i * tile;
      const y = oy + j * tile;
      const n = hash(i, j) - 0.5;
      ctx.fillStyle = n > 0 ? `rgb(255 255 255 / ${n * 0.16})` : `rgb(10 40 60 / ${-n * 0.07})`;
      ctx.fillRect(x, y, tile, tile);
      const g = ctx.createLinearGradient(x, y, x + tile, y + tile);
      g.addColorStop(0, "rgb(255 255 255 / 0.22)");
      g.addColorStop(0.35, "rgb(255 255 255 / 0.04)");
      g.addColorStop(0.7, "rgb(0 30 50 / 0)");
      g.addColorStop(1, "rgb(0 30 50 / 0.06)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y, tile, tile);
    }
  }

  ctx.fillStyle = "rgb(128 160 166 / 0.42)";
  for (let i = 0; i <= cols; i += 1) ctx.fillRect(ox + i * tile - grout / 2, 0, grout, height);
  for (let j = 0; j <= rows; j += 1) ctx.fillRect(0, oy + j * tile - grout / 2, width, grout);
  ctx.fillStyle = "rgb(255 255 255 / 0.4)";
  for (let i = 0; i <= cols; i += 1) ctx.fillRect(ox + i * tile + grout / 2, 0, 0.8, height);
  for (let j = 0; j <= rows; j += 1) ctx.fillRect(0, oy + j * tile + grout / 2, width, 0.8);
  return layout;
}
