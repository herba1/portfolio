export const PHOTOS = [
  { id: "valley", src: "/scorch/valley.webp", title: "Alpine valley", short: "Valley", crop: [0.1, 0.2, 0.82, 0.547] },
  { id: "wires", src: "/scorch/wires.webp", title: "Dusk on the wires", short: "Wires", crop: [0, 0.13, 1, 0.635] },
  { id: "meadow", src: "/scorch/meadow.webp", title: "Wildflower meadow", short: "Meadow", crop: [0, 0.2, 1, 0.667] },
];

export const PHOTO_W = 1200;
export const PHOTO_H = 800;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return { canvas, ctx };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export function photoCanvas(image, photo) {
  const { canvas, ctx } = surface(PHOTO_W, PHOTO_H);
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const [cx, cy, cw, ch] = photo.crop;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "saturate(1.04) contrast(1.03)";
  ctx.drawImage(image, cx * iw, cy * ih, cw * iw, ch * ih, 0, 0, PHOTO_W, PHOTO_H);
  ctx.filter = "none";
  return canvas;
}

export function fibreCanvas() {
  const size = 256;
  const rnd = mulberry(9127);
  const cloud = surface(size, size);
  const small = surface(16, 16);
  const img = small.ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i += 1) {
    const v = 110 + rnd() * 60;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  small.ctx.putImageData(img, 0, 0);
  cloud.ctx.imageSmoothingEnabled = true;
  for (let ox = -1; ox <= 1; ox += 1) {
    for (let oy = -1; oy <= 1; oy += 1) cloud.ctx.drawImage(small.canvas, ox * size, oy * size, size, size);
  }
  const fibres = surface(size, size);
  fibres.ctx.fillStyle = "rgb(128 128 128)";
  fibres.ctx.fillRect(0, 0, size, size);
  fibres.ctx.lineCap = "round";
  for (let i = 0; i < 520; i += 1) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI * 2;
    const len = 3 + rnd() * 9;
    const light = rnd() < 0.45;
    fibres.ctx.strokeStyle = light ? `rgb(255 255 255 / ${0.18 + rnd() * 0.22})` : `rgb(0 0 0 / ${0.1 + rnd() * 0.18})`;
    fibres.ctx.lineWidth = 0.5 + rnd() * 0.7;
    for (let ox = -1; ox <= 1; ox += 1) {
      for (let oy = -1; oy <= 1; oy += 1) {
        fibres.ctx.beginPath();
        fibres.ctx.moveTo(x + ox * size, y + oy * size);
        fibres.ctx.quadraticCurveTo(
          x + ox * size + Math.cos(a + 0.4) * len * 0.5,
          y + oy * size + Math.sin(a + 0.4) * len * 0.5,
          x + ox * size + Math.cos(a) * len,
          y + oy * size + Math.sin(a) * len,
        );
        fibres.ctx.stroke();
      }
    }
  }
  const out = surface(size, size);
  const c = cloud.ctx.getImageData(0, 0, size, size).data;
  const f = fibres.ctx.getImageData(0, 0, size, size).data;
  const data = out.ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    data.data[i * 4] = c[i * 4];
    data.data[i * 4 + 1] = f[i * 4];
    data.data[i * 4 + 2] = Math.floor(rnd() * 256);
    data.data[i * 4 + 3] = 255;
  }
  out.ctx.putImageData(data, 0, 0);
  return out.canvas;
}

export function labelCanvas() {
  const { canvas, ctx } = surface(1024, 96);
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace";
  ctx.clearRect(0, 0, 1024, 96);
  ctx.fillStyle = "#fff";
  ctx.font = `500 15px ${mono}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Strip-cut 24", 70, 48);
  ctx.globalAlpha = 0.7;
  ctx.fillText("6 mm", 200, 48);
  ctx.globalAlpha = 1;
  for (let i = 0; i < 7; i += 1) {
    ctx.beginPath();
    ctx.roundRect(640 + i * 14, 38, 6, 20, 3);
    ctx.fill();
  }
  return canvas;
}

export function backprintCanvas() {
  const { canvas, ctx } = surface(512, 512);
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "ui-monospace, Menlo, monospace";
  ctx.clearRect(0, 0, 512, 512);
  ctx.fillStyle = "#fff";
  ctx.font = `500 13px ${mono}`;
  ctx.textBaseline = "middle";
  const line = "archival gloss  ·  no. 24  ·  ";
  const w = ctx.measureText(line).width;
  for (let row = 0; row < 16; row += 1) {
    const y = 16 + row * 32;
    const shift = (row % 2) * (w / 2);
    for (let x = -w; x < 512 + w; x += w) ctx.fillText(line, x - shift, y);
  }
  return canvas;
}
