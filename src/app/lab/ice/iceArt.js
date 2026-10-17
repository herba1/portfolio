export const ART_SIZE = 1024;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fontStack(name) {
  const fam = getComputedStyle(document.body).getPropertyValue(name).trim();
  return fam || "Helvetica Neue, Arial, sans-serif";
}

export async function buildSleeve(sleeve, index) {
  const img = await loadImage(sleeve.src);
  const size = ART_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const rand = seeded(9173 + index * 131);

  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const side = Math.min(iw, ih) / sleeve.zoom;
  const sx = Math.max(0, Math.min(iw - side, iw * sleeve.focus - side / 2));
  const sy = Math.max(0, Math.min(ih - side, ih * 0.5 - side / 2));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

  const vignette = ctx.createRadialGradient(size * 0.5, size * 0.48, size * 0.2, size * 0.5, size * 0.5, size * 0.78);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.55, "rgba(0,0,0,0.04)");
  vignette.addColorStop(0.8, "rgba(0,0,0,0.12)");
  vignette.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth = 26;
  ctx.shadowColor = "rgba(255,255,255,0.08)";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(size * 0.65, size * 0.5, size * 0.455, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const grain = document.createElement("canvas");
  grain.width = 256;
  grain.height = 256;
  const g = grain.getContext("2d");
  const data = g.createImageData(256, 256);
  for (let i = 0; i < data.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 90;
    data.data[i] = v;
    data.data[i + 1] = v;
    data.data[i + 2] = v;
    data.data[i + 3] = 255;
  }
  g.putImageData(data, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grain, "repeat");
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  for (let i = 0; i < 4; i += 1) {
    ctx.lineWidth = 2 + i * 2;
    ctx.globalAlpha = 0.5 / (i + 1);
    ctx.strokeRect(i * 2 + 1, i * 2 + 1, size - i * 4 - 2, size - i * 4 - 2);
  }
  ctx.restore();

  const sans = fontStack("--font-sans");
  const mono = fontStack("--font-mono");
  ctx.fillStyle = sleeve.ink;
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 58px ${sans}`;
  ctx.fillText(sleeve.artist, 64, 118);
  ctx.font = `450 58px ${sans}`;
  ctx.globalAlpha = 0.86;
  ctx.fillText(sleeve.title, 64, 184);
  ctx.globalAlpha = 1;
  ctx.font = `500 26px ${mono}`;
  ctx.textAlign = "right";
  ctx.fillText(sleeve.cat, size - 64, size - 64);
  ctx.textAlign = "left";
  ctx.fillText("33⅓", 64, size - 64);

  return canvas;
}
