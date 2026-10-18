import { ALBUMS, FEATURED } from "@/app/lab/_music/catalog";

export const PACK = { W: 1, H: 1.72, CRIMP: 0.09, TEAR: 0.2 };
export const CARD = { W: 0.8, H: 1.12 };
export const RARITY = [
  { key: "common", name: "Common", mark: "●" },
  { key: "common", name: "Common", mark: "●" },
  { key: "common", name: "Common", mark: "●" },
  { key: "uncommon", name: "Uncommon", mark: "◆" },
  { key: "uncommon", name: "Uncommon", mark: "◆" },
  { key: "rare", name: "Rare holo", mark: "★" },
];

const PW = 1000;
const PH = 1720;
const CW = 600;
const CH = 840;
const PX = 1000;
const SERIF = '"Iowan Old Style", "Times New Roman", Georgia, serif';
const CRIMP_PX = PACK.CRIMP * PX;
const TEAR_PX = PACK.TEAR * PX;

const byTitle = new Map(ALBUMS.map((a) => [a.title.toLowerCase(), a]));

const keyOf = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function albumsFrom(tracks) {
  const groups = new Map();
  for (const track of tracks || []) {
    const name = track.album || track.title;
    const key = keyOf(`${track.artist}-${name}`);
    if (!groups.has(key)) {
      const known = byTitle.get(String(name).toLowerCase());
      const remoteSrc = track.imageLarge || track.image || "";
      groups.set(key, {
        key,
        title: known ? known.title : name,
        artist: track.artist,
        year: known ? known.year : track.year || null,
        src: known ? known.cover : remoteSrc,
        remote: !known && /^https?:/.test(remoteSrc),
        tracks: known ? known.tracks : [],
        songs: [],
      });
    }
    groups.get(key).songs.push(track.title);
  }
  for (const album of ALBUMS) {
    const key = keyOf(`${album.artist}-${album.title}`);
    if (groups.has(key)) continue;
    groups.set(key, {
      key,
      title: album.title,
      artist: album.artist,
      year: album.year,
      src: album.cover,
      remote: false,
      tracks: album.tracks,
      songs: [],
    });
  }
  return [...groups.values()].filter((a) => a.src);
}

export function dealPack(pool, rand = Math.random) {
  const list = pool.slice();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  const cards = list.slice(0, RARITY.length).map((album, i) => {
    const moves = [...new Set([...album.songs, ...album.tracks])].slice(0, 2);
    return { ...album, moves, rarity: RARITY[i], number: i + 1, count: RARITY.length };
  });
  const names = new Set(cards.map((c) => c.title));
  const spare = FEATURED.filter((a) => !names.has(a.title));
  const featured = spare.length ? spare[Math.floor(rand() * spare.length)] : FEATURED[0];
  return { cards, featured };
}

export function loadCover(src, remote) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    if (remote) img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function canvasOf(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function squareCrop(img) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const s = Math.min(w, h);
  return [(w - s) / 2, (h - s) / 2, s, s];
}

function fit(ctx, text, maxWidth, sizes, weight, family) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
  }
  return sizes[sizes.length - 1];
}

function clip(ctx, text, maxWidth) {
  let out = String(text);
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 2 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function averageOf(img) {
  if (!img) return [120, 120, 130];
  try {
    const c = canvasOf(8, 8);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, ...squareCrop(img), 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    const sum = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i];
      sum[1] += d[i + 1];
      sum[2] += d[i + 2];
    }
    return sum.map((v) => v / 64);
  } catch {
    return [120, 120, 130];
  }
}

const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]} ${c[1]} ${c[2]})`;

function crimpBand(ctx, y0, y1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, "#c7ccd6");
  g.addColorStop(0.5, "#f1f3f6");
  g.addColorStop(1, "#aab1bd");
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, PW, y1 - y0);
  for (let x = 0; x < PW; x += 8) {
    ctx.fillStyle = "rgb(255 255 255 / 0.5)";
    ctx.fillRect(x, y0, 3, y1 - y0);
    ctx.fillStyle = "rgb(60 66 80 / 0.22)";
    ctx.fillRect(x + 4, y0, 2, y1 - y0);
  }
}

function cutEdges(ctx) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  for (let x = 0; x < PW; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 20, 0);
    ctx.lineTo(x + 10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, PH);
    ctx.lineTo(x + 20, PH);
    ctx.lineTo(x + 10, PH - 12);
    ctx.closePath();
    ctx.fill();
  }
  for (const side of [0, PW]) {
    const dx = side === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(side, TEAR_PX - 20);
    ctx.lineTo(side + dx * 24, TEAR_PX);
    ctx.lineTo(side, TEAR_PX + 20);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function packFront(featured, img, sans) {
  const c = canvasOf(PW, PH);
  const ctx = c.getContext("2d");
  const base = ctx.createLinearGradient(0, 0, PW * 0.3, PH);
  base.addColorStop(0, "#2a1d78");
  base.addColorStop(0.36, "#4a1f96");
  base.addColorStop(0.7, "#1f44ad");
  base.addColorStop(1, "#111b55");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, PW, PH);
  const cx = PW / 2;
  const cy = 900;
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 28; i += 1) {
    const a0 = (i / 28) * Math.PI * 2;
    const a1 = a0 + Math.PI / 28;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 1500, a0, a1);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? "rgb(255 255 255 / 0.05)" : "rgb(150 220 255 / 0.09)";
    ctx.fill();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(cx, cy, 40, cx, cy, 620);
  glow.addColorStop(0, "rgb(255 140 214 / 0.5)");
  glow.addColorStop(0.5, "rgb(255 110 190 / 0.14)");
  glow.addColorStop(1, "rgb(255 110 190 / 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, PW, PH);

  ctx.fillStyle = "#151a3d";
  ctx.fillRect(0, CRIMP_PX, PW, TEAR_PX - CRIMP_PX);
  ctx.fillStyle = "#f4f1ea";
  ctx.font = `500 30px ${sans}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const mid = (CRIMP_PX + TEAR_PX) / 2 + 2;
  ctx.fillText("Tear here", 60, mid);
  ctx.textAlign = "right";
  ctx.fillText("Open from either notch", PW - 60, mid);
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = "rgb(244 241 234 / 0.75)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(30, TEAR_PX - 1);
  ctx.lineTo(PW - 30, TEAR_PX - 1);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 128px ${sans}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = 18;
  ctx.strokeStyle = "#120f3a";
  ctx.strokeText("Top Songs", cx, 360);
  const word = ctx.createLinearGradient(0, 260, 0, 370);
  word.addColorStop(0, "#fff7c2");
  word.addColorStop(0.55, "#ffd23f");
  word.addColorStop(1, "#ff9f1c");
  ctx.fillStyle = word;
  ctx.fillText("Top Songs", cx, 360);
  ctx.font = `italic 400 60px ${SERIF}`;
  ctx.fillStyle = "#f4f1ea";
  ctx.fillText("Album Cards", cx, 436);

  const side = 540;
  ctx.save();
  ctx.translate(cx, cy + 10);
  ctx.rotate(-0.08);
  ctx.shadowColor = "rgb(8 6 30 / 0.55)";
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = "#f7f5f0";
  ctx.fillRect(-side / 2 - 18, -side / 2 - 18, side + 36, side + 36);
  ctx.shadowColor = "transparent";
  if (img) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, ...squareCrop(img), -side / 2, -side / 2, side, side);
  } else {
    ctx.fillStyle = "#2b2b36";
    ctx.fillRect(-side / 2, -side / 2, side, side);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(800, 560);
  ctx.rotate(0.22);
  ctx.beginPath();
  for (let i = 0; i < 32; i += 1) {
    const r = i % 2 ? 84 : 104;
    const a = (i / 32) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = "#ffd23f";
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#120f3a";
  ctx.stroke();
  ctx.fillStyle = "#120f3a";
  ctx.textAlign = "center";
  ctx.font = `700 76px ${sans}`;
  ctx.fillText("6", 0, 16);
  ctx.font = `600 26px ${sans}`;
  ctx.fillText("cards", 0, 50);
  ctx.restore();

  ctx.textAlign = "center";
  ctx.fillStyle = "#f4f1ea";
  ctx.font = `500 32px ${sans}`;
  ctx.fillText("Featuring", cx, 1278);
  const title = featured?.title || "";
  ctx.font = `italic 400 ${fit(ctx, title, 820, [64, 56, 48, 42, 36], "italic 400", SERIF)}px ${SERIF}`;
  ctx.fillText(clip(ctx, title, 840), cx, 1350);
  ctx.font = `500 32px ${sans}`;
  ctx.fillText([featured?.artist, featured?.year].filter(Boolean).join(" · "), cx, 1404);

  roundRect(ctx, 110, 1474, PW - 220, 76, 38);
  ctx.fillStyle = "rgb(10 12 40 / 0.6)";
  ctx.fill();
  ctx.fillStyle = "#f4f1ea";
  ctx.font = `500 28px ${sans}`;
  ctx.fillText("● Common   ◆ Uncommon   ★ Rare holo", cx, 1522);

  crimpBand(ctx, 0, CRIMP_PX);
  crimpBand(ctx, PH - CRIMP_PX, PH);
  cutEdges(ctx);
  return c;
}

export function packBack(sans) {
  const c = canvasOf(PW, PH);
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, PW, PH);
  g.addColorStop(0, "#c3c9d3");
  g.addColorStop(0.45, "#eef0f4");
  g.addColorStop(0.7, "#cfd4dc");
  g.addColorStop(1, "#a9b0bc");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, PW, PH);
  const fin = PW / 2 - 30;
  ctx.fillStyle = "rgb(90 98 116 / 0.18)";
  ctx.fillRect(fin, 0, 60, PH);
  for (let y = 0; y < PH; y += 10) {
    ctx.fillStyle = "rgb(255 255 255 / 0.4)";
    ctx.fillRect(fin, y, 60, 3);
  }
  ctx.fillStyle = "#2a2e3a";
  ctx.textAlign = "center";
  ctx.font = `600 34px ${sans}`;
  ctx.fillText("Open from the top", PW / 2, 280);
  const panel = (x) => {
    ctx.textAlign = "left";
    ctx.font = `700 54px ${sans}`;
    ctx.fillText("Top Songs", x, 480);
    ctx.font = `italic 400 40px ${SERIF}`;
    ctx.fillText("Album Cards", x, 540);
    ctx.font = `500 30px ${sans}`;
    ["6 cards a pack", "3 common ●", "2 uncommon ◆", "1 rare holo ★", "The rare sits", "at the back"].forEach((line, i) =>
      ctx.fillText(line, x, 660 + i * 48),
    );
  };
  panel(80);
  panel(PW / 2 + 70);
  crimpBand(ctx, 0, CRIMP_PX);
  crimpBand(ctx, PH - CRIMP_PX, PH);
  cutEdges(ctx);
  return c;
}

export function cutMask() {
  const c = canvasOf(PW / 2, PH / 2);
  const ctx = c.getContext("2d");
  ctx.scale(0.5, 0.5);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, PW, PH);
  ctx.fillStyle = "#000";
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  const probe = canvasOf(PW, PH);
  const pctx = probe.getContext("2d");
  pctx.fillStyle = "#fff";
  pctx.fillRect(0, 0, PW, PH);
  cutEdges(pctx);
  ctx.fillRect(0, 0, PW, PH);
  ctx.drawImage(probe, 0, 0);
  ctx.restore();
  return c;
}

export function crinkleMap() {
  const w = 500;
  const h = 860;
  const c = canvasOf(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgb(128 128 128)";
  ctx.fillRect(0, 0, w, h);
  const r = rng(7);
  for (let i = 0; i < 260; i += 1) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    const len = 20 + r() * 120;
    ctx.strokeStyle = r() > 0.5 ? `rgb(255 255 255 / ${0.06 + r() * 0.1})` : `rgb(0 0 0 / ${0.06 + r() * 0.1})`;
    ctx.lineWidth = 1 + r() * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  const crimp = (PACK.CRIMP / PACK.H) * h;
  for (let x = 0; x < w; x += 4) {
    ctx.fillStyle = "rgb(250 250 250)";
    ctx.fillRect(x, 0, 2, crimp);
    ctx.fillRect(x, h - crimp, 2, crimp);
    ctx.fillStyle = "rgb(20 20 20)";
    ctx.fillRect(x + 2, 0, 2, crimp);
    ctx.fillRect(x + 2, h - crimp, 2, crimp);
  }
  return c;
}

export function shadowCanvas() {
  const c = canvasOf(128, 128);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  g.addColorStop(0, "rgb(40 34 26 / 0.5)");
  g.addColorStop(0.55, "rgb(40 34 26 / 0.2)");
  g.addColorStop(1, "rgb(40 34 26 / 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

export function haloCanvas() {
  const c = canvasOf(128, 128);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, "rgb(255 214 110 / 0.9)");
  g.addColorStop(0.5, "rgb(255 190 90 / 0.35)");
  g.addColorStop(1, "rgb(255 190 90 / 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return c;
}

export function cardFace(card, img, sans) {
  const c = canvasOf(CW, CH);
  const ctx = c.getContext("2d");
  const rare = card.rarity.key === "rare";
  const avg = averageOf(img);
  roundRect(ctx, 0, 0, CW, CH, 30);
  ctx.save();
  ctx.clip();
  const rim = ctx.createLinearGradient(0, 0, CW, CH);
  if (rare) {
    rim.addColorStop(0, "#f7e7b0");
    rim.addColorStop(0.4, "#c99a3c");
    rim.addColorStop(0.7, "#f3dc8a");
    rim.addColorStop(1, "#a8792a");
  } else {
    rim.addColorStop(0, "#eef1f4");
    rim.addColorStop(0.45, "#a3abb6");
    rim.addColorStop(0.75, "#dde1e7");
    rim.addColorStop(1, "#8f98a4");
  }
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, CW, CH);
  const ground = mixRgb(avg, [250, 247, 240], 0.72);
  const deep = mixRgb(avg, [40, 36, 30], 0.35);
  roundRect(ctx, 18, 18, CW - 36, CH - 36, 16);
  ctx.fillStyle = rgb(ground);
  ctx.fill();
  const ink = "#1f1d1a";

  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const yearText = card.year ? String(card.year) : "";
  ctx.font = `600 26px ${sans}`;
  const yearW = yearText ? ctx.measureText(yearText).width + 20 : 0;
  const tSize = fit(ctx, card.title, CW - 80 - yearW, [36, 32, 28, 26], 600, sans);
  ctx.font = `600 ${tSize}px ${sans}`;
  ctx.fillText(clip(ctx, card.title, CW - 80 - yearW), 40, 68);
  if (yearText) {
    ctx.textAlign = "right";
    ctx.font = `600 26px ${sans}`;
    ctx.fillText(yearText, CW - 40, 68);
    ctx.textAlign = "left";
  }

  const win = { x: 40, y: 86, s: 520 };
  ctx.fillStyle = rgb(deep);
  ctx.fillRect(win.x - 6, win.y - 6, win.s + 12, win.s + 12);
  if (img) {
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, ...squareCrop(img), win.x, win.y, win.s, win.s);
  } else {
    ctx.fillStyle = rgb(mixRgb(avg, [30, 30, 40], 0.4));
    ctx.fillRect(win.x, win.y, win.s, win.s);
  }

  const bandY = 618;
  roundRect(ctx, 34, bandY, CW - 68, 46, 10);
  ctx.fillStyle = rgb(mixRgb(avg, [250, 247, 240], 0.45));
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.font = `italic 400 26px ${SERIF}`;
  ctx.fillText(clip(ctx, card.artist, 330), 52, bandY + 32);
  ctx.textAlign = "right";
  ctx.font = `600 22px ${sans}`;
  ctx.fillText(`${card.rarity.name} ${card.rarity.mark}`, CW - 52, bandY + 31);
  ctx.textAlign = "left";

  card.moves.forEach((name, i) => {
    const y = 700 + i * 50;
    ctx.beginPath();
    ctx.arc(58, y - 8, 17, 0, Math.PI * 2);
    ctx.fillStyle = rare ? "#c99a3c" : rgb(deep);
    ctx.fill();
    ctx.fillStyle = "#faf7f0";
    ctx.textAlign = "center";
    ctx.font = `600 16px ${sans}`;
    ctx.fillText(`A${i + 1}`, 58, y - 2);
    ctx.textAlign = "left";
    ctx.fillStyle = ink;
    ctx.font = `500 26px ${sans}`;
    ctx.fillText(clip(ctx, name, CW - 150), 88, y);
    ctx.fillStyle = "rgb(31 29 26 / 0.18)";
    ctx.fillRect(40, y + 16, CW - 80, 2);
  });

  ctx.fillStyle = ink;
  ctx.font = `500 20px ${sans}`;
  const footY = CH - 38;
  ctx.fillText(`${String(card.number).padStart(2, "0")}/${String(card.count).padStart(2, "0")}`, 40, footY);
  ctx.textAlign = "center";
  ctx.font = `600 24px ${sans}`;
  ctx.fillText(card.rarity.mark, CW / 2, footY + 1);
  ctx.textAlign = "right";
  ctx.font = `500 20px ${sans}`;
  ctx.fillText("Top Songs", CW - 40, footY);
  ctx.restore();
  return c;
}
