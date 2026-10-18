function layer(w, h, dpr) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { canvas, ctx };
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function grad(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function geometry(S) {
  const headW = S;
  const headH = Math.round(S * 0.3);
  const lip = Math.round(S * 0.05);
  const binTop = S * 0.9;
  const binBottom = S * 0.78;
  const binH = Math.round(S * 0.66);
  const cover = Math.round(S * 0.6);
  const strips = 16;
  return { S, headW, headH, lip, binTop, binBottom, binH, cover, strips };
}

export function drawBinBack(g, dpr) {
  const w = g.binTop + 8;
  const h = g.binH + 8;
  const { canvas, ctx } = layer(w, h, dpr);
  const x0 = 4;
  const inset = (g.binTop - g.binBottom) / 2;
  ctx.beginPath();
  ctx.moveTo(x0, 0);
  ctx.lineTo(x0 + g.binTop, 0);
  ctx.lineTo(x0 + g.binTop - inset, g.binH - 10);
  ctx.quadraticCurveTo(x0 + g.binTop - inset, g.binH, x0 + g.binTop - inset - 10, g.binH);
  ctx.lineTo(x0 + inset + 10, g.binH);
  ctx.quadraticCurveTo(x0 + inset, g.binH, x0 + inset, g.binH - 10);
  ctx.closePath();
  ctx.fillStyle = grad(ctx, 0, 0, 0, g.binH, [
    [0, "#101113"],
    [0.35, "#1c1d20"],
    [0.75, "#26272b"],
    [1, "#151618"],
  ]);
  ctx.fill();
  return canvas;
}

export function drawBinFront(g, dpr) {
  const w = g.binTop + 8;
  const h = g.binH + 8;
  const { canvas, ctx } = layer(w, h, dpr);
  const x0 = 4;
  const inset = (g.binTop - g.binBottom) / 2;
  const shape = () => {
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0 + g.binTop, 0);
    ctx.lineTo(x0 + g.binTop - inset, g.binH - 10);
    ctx.quadraticCurveTo(x0 + g.binTop - inset, g.binH, x0 + g.binTop - inset - 10, g.binH);
    ctx.lineTo(x0 + inset + 10, g.binH);
    ctx.quadraticCurveTo(x0 + inset, g.binH, x0 + inset, g.binH - 10);
    ctx.closePath();
  };
  ctx.save();
  shape();
  ctx.clip();
  const pitch = Math.max(9, g.S * 0.034);
  ctx.strokeStyle = "rgb(22 23 26 / 0.94)";
  ctx.lineWidth = Math.max(1.4, pitch * 0.16);
  for (let x = -g.binH; x < g.binTop + g.binH; x += pitch) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + g.binH, g.binH);
    ctx.moveTo(x + g.binH, 0);
    ctx.lineTo(x, g.binH);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgb(255 255 255 / 0.08)";
  ctx.lineWidth = 0.8;
  for (let x = -g.binH; x < g.binTop + g.binH; x += pitch) {
    ctx.beginPath();
    ctx.moveTo(x + 0.8, 0);
    ctx.lineTo(x + 0.8 + g.binH, g.binH);
    ctx.stroke();
  }
  ctx.fillStyle = grad(ctx, x0, 0, x0 + g.binTop, 0, [
    [0, "rgb(255 255 255 / 0.16)"],
    [0.12, "rgb(255 255 255 / 0.05)"],
    [0.5, "rgb(255 255 255 / 0)"],
    [0.86, "rgb(0 0 0 / 0.12)"],
    [1, "rgb(0 0 0 / 0.3)"],
  ]);
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  shape();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#0c0c0d";
  ctx.stroke();
  const rimH = Math.round(g.S * 0.045);
  rr(ctx, x0 - 2, -2, g.binTop + 4, rimH, rimH / 2);
  ctx.fillStyle = grad(ctx, 0, -2, 0, rimH, [
    [0, "#fbfbfc"],
    [0.3, "#c9ccd1"],
    [0.55, "#8f949b"],
    [0.8, "#d6d9dd"],
    [1, "#6f747b"],
  ]);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgb(40 42 46 / 0.7)";
  ctx.stroke();
  return canvas;
}

export function drawHeadBack(g, dpr) {
  const { canvas, ctx } = layer(g.headW + 8, g.lip + 8, dpr);
  rr(ctx, 4, 2, g.headW, g.lip * 2, g.lip);
  ctx.fillStyle = grad(ctx, 0, 2, 0, g.lip * 2, [
    [0, "#9fa4ab"],
    [0.4, "#d2d5d9"],
    [1, "#eceef0"],
  ]);
  ctx.fill();
  const slotY = 2 + g.lip * 0.62;
  const slotX = 4 + g.headW * 0.1;
  const slotW = g.headW * 0.8;
  rr(ctx, slotX, slotY - 4, slotW, 8, 4);
  ctx.fillStyle = grad(ctx, 0, slotY - 4, 0, slotY + 4, [
    [0, "#030304"],
    [0.6, "#16171a"],
    [1, "#3a3d42"],
  ]);
  ctx.fill();
  return canvas;
}

export function drawHeadFront(g, dpr, sans) {
  const pad = 24;
  const { canvas, ctx } = layer(g.headW + pad * 2, g.headH + g.lip + pad * 2, dpr);
  ctx.translate(pad, pad);
  const top = g.lip * 0.62;
  const h = g.headH + g.lip - top;
  ctx.save();
  ctx.shadowColor = "rgb(20 24 30 / 0.35)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  rr(ctx, 0, top, g.headW, h, [4, 4, g.headH * 0.22, g.headH * 0.22]);
  ctx.fillStyle = "#c9ccd1";
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, 0, top, g.headW, h, [4, 4, g.headH * 0.22, g.headH * 0.22]);
  ctx.clip();
  ctx.fillStyle = grad(ctx, 0, top, 0, top + h, [
    [0, "#fdfdfd"],
    [0.08, "#e9ebee"],
    [0.45, "#cfd2d7"],
    [0.52, "#bfc3c9"],
    [0.85, "#d9dce0"],
    [1, "#9a9fa6"],
  ]);
  ctx.fillRect(0, top, g.headW, h);
  const rand = mulberry(6);
  for (let y = top; y < top + h; y += 1) {
    ctx.fillStyle = rand() < 0.5 ? `rgb(255 255 255 / ${0.05 + rand() * 0.12})` : `rgb(60 64 70 / ${0.03 + rand() * 0.07})`;
    ctx.fillRect(0, y, g.headW, 0.6);
  }
  ctx.fillStyle = grad(ctx, 0, top, 0, top + h * 0.5, [
    [0, "rgb(255 255 255 / 0.55)"],
    [0.4, "rgb(255 255 255 / 0.18)"],
    [1, "rgb(255 255 255 / 0)"],
  ]);
  ctx.fillRect(0, top, g.headW, h * 0.5);
  ctx.restore();
  rr(ctx, 0.5, top + 0.5, g.headW - 1, h - 1, [4, 4, g.headH * 0.22, g.headH * 0.22]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgb(70 74 80 / 0.8)";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, top + 1.5);
  ctx.lineTo(g.headW - 6, top + 1.5);
  ctx.strokeStyle = "rgb(255 255 255 / 0.95)";
  ctx.stroke();

  const bandX = g.headW * 0.06;
  const bandY = top + h * 0.3;
  const bandW = g.headW * 0.88;
  const bandH = h * 0.56;
  ctx.save();
  ctx.shadowColor = "rgb(255 255 255 / 0.8)";
  ctx.shadowOffsetY = 1;
  rr(ctx, bandX, bandY, bandW, bandH, bandH * 0.3);
  ctx.fillStyle = "#3b2418";
  ctx.fill();
  ctx.restore();
  ctx.save();
  rr(ctx, bandX, bandY, bandW, bandH, bandH * 0.3);
  ctx.clip();
  ctx.fillStyle = grad(ctx, 0, bandY, 0, bandY + bandH, [
    [0, "#6b4330"],
    [0.5, "#53321f"],
    [1, "#3a2216"],
  ]);
  ctx.fillRect(bandX, bandY, bandW, bandH);
  for (let i = 0; i < bandW * bandH * 0.08; i += 1) {
    const x = bandX + rand() * bandW;
    const y = bandY + rand() * bandH;
    ctx.fillStyle = rand() < 0.5 ? "rgb(0 0 0 / 0.16)" : "rgb(255 220 190 / 0.07)";
    ctx.fillRect(x, y, 1.2, 1.2);
  }
  ctx.fillStyle = grad(ctx, 0, bandY, 0, bandY + bandH * 0.4, [
    [0, "rgb(255 230 210 / 0.2)"],
    [1, "rgb(255 230 210 / 0)"],
  ]);
  ctx.fillRect(bandX, bandY, bandW, bandH * 0.4);
  ctx.restore();
  ctx.save();
  rr(ctx, bandX + 6, bandY + 6, bandW - 12, bandH - 12, bandH * 0.22);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgb(0 0 0 / 0.35)";
  ctx.translate(0, 1);
  ctx.stroke();
  ctx.translate(0, -1);
  ctx.strokeStyle = "#e9d3a8";
  ctx.stroke();
  ctx.restore();

  const fs = Math.round(bandH * 0.34);
  ctx.font = `600 ${fs}px ${sans}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const tx = bandX + bandH * 0.42;
  const ty = bandY + bandH / 2 + 1;
  ctx.fillStyle = "rgb(255 220 190 / 0.22)";
  ctx.fillText("Shred", tx, ty + 1);
  ctx.fillStyle = "#24140c";
  ctx.fillText("Shred", tx, ty);
  return { canvas, pad, top, button: { x: bandX + bandW - bandH * 0.5, y: bandY + bandH / 2, r: bandH * 0.3 } };
}

export function drawButton(ctx, x, y, r, on, glow) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = grad(ctx, 0, y - r - 3, 0, y + r + 3, [
    [0, "#f7f8f9"],
    [0.5, "#9da2a9"],
    [1, "#e3e5e8"],
  ]);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const lit = on ? 1 : 0.18 + glow * 0.4;
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, `rgb(${Math.round(150 + 105 * lit)} 255 ${Math.round(150 + 60 * lit)})`);
  g.addColorStop(0.45, `rgb(${Math.round(30 + 40 * lit)} ${Math.round(110 + 110 * lit)} ${Math.round(40 + 30 * lit)})`);
  g.addColorStop(1, `rgb(10 ${Math.round(50 + 50 * lit)} 18)`);
  ctx.fillStyle = g;
  if (on) {
    ctx.shadowColor = "rgb(90 255 120 / 0.9)";
    ctx.shadowBlur = r * 1.6;
  }
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.45, r * 0.62, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgb(255 255 255 / 0.55)";
  ctx.fill();
  ctx.restore();
}
