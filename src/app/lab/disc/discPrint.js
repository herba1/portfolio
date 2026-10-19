export const ALBUM = {
  title: "Abbey Road",
  artist: "The Beatles",
  year: 1969,
  catalogue: "CDP 7 46446 2",
  cover: "/tierlist/images/image-mqobr6yd.webp",
  tracks: [
    ["Come Together", 260],
    ["Something", 183],
    ["Maxwell's Silver Hammer", 207],
    ["Oh! Darling", 206],
    ["Octopus's Garden", 171],
    ["I Want You (She's So Heavy)", 467],
    ["Here Comes the Sun", 185],
    ["Because", 165],
    ["You Never Give Me Your Money", 242],
    ["Sun King", 146],
    ["Mean Mr. Mustard", 66],
    ["Polythene Pam", 72],
    ["She Came In Through the Bathroom Window", 117],
    ["Golden Slumbers", 91],
    ["Carry That Weight", 96],
    ["The End", 125],
    ["Her Majesty", 23],
  ],
};

export function trackRadii() {
  const r0 = 25;
  const k = 0.662;
  let t = 0;
  const radii = [];
  for (const [, seconds] of ALBUM.tracks) {
    t += seconds;
    radii.push(Math.sqrt(r0 * r0 + k * t) / 60);
  }
  return radii;
}

function arcText(ctx, text, cx, cy, radius, centerAngle, bottom) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const span = total / radius;
  let angle = bottom ? centerAngle + span / 2 : centerAngle - span / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i];
    const half = w / 2 / radius;
    angle += bottom ? -half : half;
    ctx.save();
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.rotate(bottom ? angle - Math.PI / 2 : angle + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle += bottom ? -half : half;
  });
}

export function paintLabel(image, size = 1024) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const c = size / 2;
  const mm = c / 60;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, 59.4 * mm, 0, Math.PI * 2);
  ctx.arc(c, c, 17.2 * mm, 0, Math.PI * 2, true);
  ctx.clip();
  ctx.fillStyle = "#f3f1ec";
  ctx.fillRect(0, 0, size, size);
  const side = 120 * mm;
  ctx.filter = "saturate(0.92) contrast(0.97)";
  ctx.drawImage(image, c - side / 2, c - side / 2, side, side);
  ctx.filter = "none";
  const shade = ctx.createRadialGradient(c, c, 17 * mm, c, c, 60 * mm);
  shade.addColorStop(0, "rgba(255,255,255,0.05)");
  shade.addColorStop(0.6, "rgba(255,255,255,0)");
  shade.addColorStop(1, "rgba(0,0,0,0.04)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(c, c, 22.5 * mm, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(246,244,239,0.94)";
  ctx.fill();
  ctx.fillStyle = "#1f1d1b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(2.3 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(ctx, "THE BEATLES", c, c, 19.6 * mm, -Math.PI / 2, false);
  ctx.font = `400 ${Math.round(2.1 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(ctx, "ABBEY ROAD  ·  1969", c, c, 19.8 * mm, Math.PI / 2, true);
  ctx.fillStyle = "rgba(255,255,255,0.86)";
  ctx.font = `400 ${Math.round(2.0 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(ctx, "STEREO", c, c, 55.6 * mm, Math.PI * 0.08, true);
  ctx.restore();
  return canvas;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function paintEtch(size = 1024, radii = []) {
  const c = size / 2;
  const mm = c / 60;
  const layer = () => {
    const cv = document.createElement("canvas");
    cv.width = size;
    cv.height = size;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    return { cv, ctx };
  };
  const etch = layer();
  etch.ctx.fillStyle = "#fff";
  etch.ctx.textAlign = "center";
  etch.ctx.textBaseline = "middle";
  etch.ctx.font = `400 ${Math.round(1.6 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(etch.ctx, `${ALBUM.catalogue}   @   1A1   ABBEY ROAD`, c, c, 20.4 * mm, -Math.PI * 0.62, false);
  etch.ctx.font = `400 ${Math.round(1.3 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(etch.ctx, "MADE IN UK BY EMI", c, c, 18.6 * mm, Math.PI * 0.42, true);
  etch.ctx.globalAlpha = 0.5;
  etch.ctx.font = `400 ${Math.round(1.1 * mm)}px disc-arimo, Arial, sans-serif`;
  arcText(etch.ctx, "02   IFPI L042", c, c, 21.6 * mm, Math.PI * 0.16, false);
  etch.ctx.globalAlpha = 1;

  const scratch = layer();
  const rand = seeded(9071);
  scratch.ctx.lineCap = "round";
  for (let i = 0; i < 12; i += 1) {
    const r = (24 + rand() * 34) * mm;
    const a0 = rand() * Math.PI * 2;
    const len = 0.04 + rand() * 0.22;
    scratch.ctx.strokeStyle = `rgba(255,255,255,${0.15 + rand() * 0.3})`;
    scratch.ctx.lineWidth = 0.5 + rand() * 0.6;
    scratch.ctx.beginPath();
    scratch.ctx.arc(c, c, r, a0, a0 + len);
    scratch.ctx.stroke();
  }
  for (let i = 0; i < 4; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = (26 + rand() * 30) * mm;
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    const t = rand() * Math.PI;
    const l = (2 + rand() * 7) * mm;
    scratch.ctx.strokeStyle = `rgba(255,255,255,${0.3 + rand() * 0.4})`;
    scratch.ctx.lineWidth = 0.7;
    scratch.ctx.beginPath();
    scratch.ctx.moveTo(x - Math.cos(t) * l, y - Math.sin(t) * l);
    scratch.ctx.lineTo(x + Math.cos(t) * l, y + Math.sin(t) * l);
    scratch.ctx.stroke();
  }

  const dust = layer();
  for (let i = 0; i < 46; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = (19 + rand() * 40) * mm;
    dust.ctx.fillStyle = `rgba(255,255,255,${0.25 + rand() * 0.5})`;
    dust.ctx.beginPath();
    dust.ctx.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.5 + rand() * 1.3, 0, Math.PI * 2);
    dust.ctx.fill();
  }

  const e = etch.ctx.getImageData(0, 0, size, size).data;
  const s = scratch.ctx.getImageData(0, 0, size, size).data;
  const d = dust.ctx.getImageData(0, 0, size, size).data;
  const profile = new Float32Array(size);
  const noise = seeded(311);
  const knots = Array.from({ length: 160 }, () => noise());
  for (let i = 0; i < size; i += 1) {
    const r = i / size;
    const x = r * 70;
    const k = Math.floor(x);
    const f = x - k;
    const a = knots[k % 160];
    const b = knots[(k + 1) % 160];
    const n = a + (b - a) * f * f * (3 - 2 * f);
    let ring = 0;
    for (const t of radii) {
      const dist = Math.abs(r - t) * 60;
      if (dist < 0.22) ring = Math.max(ring, 1 - dist / 0.22);
    }
    profile[i] = Math.min(1, Math.max(0, 0.5 + (n - 0.5) * 0.5 + ring * 0.42));
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5 - c) / c;
      const dy = (y + 0.5 - c) / c;
      const r = Math.sqrt(dx * dx + dy * dy);
      data[i] = e[i];
      data[i + 1] = s[i];
      data[i + 2] = d[i];
      data[i + 3] = Math.round(profile[Math.min(size - 1, Math.floor(r * size))] * 255);
    }
  }
  return { width: size, height: size, data };
}
