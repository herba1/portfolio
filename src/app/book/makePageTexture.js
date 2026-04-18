import * as THREE from "three";

// Portfolio design tokens
const TOKENS = {
  bg: "#f1f5f9",         // --color-light
  text: "#1a1a1a",       // --color-dark
  textBody: "#2a2a2a",   // .prose body color
  muted: "#64748b",      // --color-muted
};

function getFontFamilies() {
  if (typeof window === "undefined") {
    return {
      sans: "system-ui, sans-serif",
      serif: '"Instrument Serif", Georgia, serif',
    };
  }
  const root = document.documentElement;
  const geist =
    getComputedStyle(root).getPropertyValue("--font-geist").trim() ||
    "system-ui, sans-serif";
  const instrument =
    getComputedStyle(root).getPropertyValue("--font-instrument-serif").trim() ||
    '"Instrument Serif"';
  return {
    sans: `${geist}, system-ui, -apple-system, Segoe UI, sans-serif`,
    serif: `${instrument}, "Instrument Serif", Georgia, serif`,
  };
}

function drawBg(ctx, W, H) {
  const base = new THREE.Color(TOKENS.bg);
  ctx.fillStyle = base.getStyle();
  ctx.fillRect(0, 0, W, H);
  // Nearly-imperceptible radial shading — keeps it from feeling sterile.
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.35, H * 0.1, W * 0.5, H * 0.6, Math.max(W, H) * 0.75);
  grad.addColorStop(0.0, base.clone().offsetHSL(0, 0, 0.01).getStyle());
  grad.addColorStop(0.35, base.getStyle());
  grad.addColorStop(1.0, base.clone().offsetHSL(0, 0, -0.015).getStyle());
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
}

function wrapParagraph(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (let n = 0; n < words.length; n++) {
    const test = line + words[n] + " ";
    if (ctx.measureText(test).width > maxWidth && n > 0) {
      ctx.fillText(line.trim(), x, yy);
      line = words[n] + " ";
      yy += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line.trim(), x, yy);
  return yy + lineHeight;
}

// DOM-like layout: real CSS pixel sizes (multiplied by dpr for the canvas).
function drawBody(ctx, body, W, H, dpr, fonts) {
  if (!body) return;
  const bodyPx = 18 * dpr;          // matches .prose body (1.125rem)
  const lineHeight = bodyPx * 1.75; // matches .prose line-height
  ctx.fillStyle = TOKENS.textBody;
  ctx.font = `400 ${bodyPx}px ${fonts.sans}`;
  ctx.textAlign = "left";

  // Reading column: capped at ~65ch, or 90% of viewport — whichever is narrower.
  const approxCharW = bodyPx * 0.52;
  const maxCol = 65 * approxCharW;
  const colWidth = Math.min(maxCol, W * 0.9);
  const marginX = (W - colWidth) / 2;
  let y = H * 0.22;
  const maxY = H * 0.9;
  for (const p of body.split("\n\n")) {
    y = wrapParagraph(ctx, p, marginX, y, colWidth, lineHeight);
    y += lineHeight * 0.4;
    if (y > maxY) break;
  }
}

function drawHeader(ctx, title, subtitle, pageNum, hasBody, W, H, dpr, fonts) {
  ctx.textAlign = "center";
  if (hasBody) {
    // Running header — small, italic, muted
    ctx.fillStyle = TOKENS.muted;
    ctx.font = `italic 400 ${14 * dpr}px ${fonts.serif}`;
    ctx.fillText(subtitle, W / 2, H * 0.12);
  } else {
    // Title page — large serif italic
    ctx.fillStyle = TOKENS.text;
    ctx.font = `italic 400 ${Math.min(96, W / 14 / dpr) * dpr}px ${fonts.serif}`;
    ctx.fillText(title, W / 2, H * 0.5);
    ctx.font = `italic 400 ${20 * dpr}px ${fonts.serif}`;
    ctx.fillStyle = TOKENS.muted;
    ctx.fillText(subtitle, W / 2, H * 0.58);
  }
  // Page number
  ctx.font = `400 ${13 * dpr}px ${fonts.sans}`;
  ctx.fillStyle = TOKENS.muted;
  ctx.fillText(String(pageNum), W / 2, H * 0.94);
}

export function makePageTexture({ title, subtitle, body, pageNum, width, height }) {
  const cssW = Math.max(320, width || 1280);
  const cssH = Math.max(240, height || 800);
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  const W = Math.min(4096, Math.round(cssW * dpr));
  const H = Math.min(4096, Math.round(cssH * dpr));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const fonts = getFontFamilies();
  drawBg(ctx, W, H);
  drawBody(ctx, body, W, H, dpr, fonts);
  drawHeader(ctx, title, subtitle, pageNum, !!body, W, H, dpr, fonts);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}
