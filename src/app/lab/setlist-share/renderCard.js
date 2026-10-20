function wrap(ctx, text, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = w;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return lines;
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

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function renderCard(card, colors) {
  await Promise.all(card.getAnimations({ subtree: true }).filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})));
  const box = card.getBoundingClientRect();
  const W = 1080;
  const k = W / box.width;
  const H = Math.round(box.height * k);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const radius = parseFloat(getComputedStyle(card).borderTopLeftRadius) * k;
  roundRect(ctx, 0, 0, W, H, radius);
  ctx.clip();
  const angle = (160 * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
  const grad = ctx.createLinearGradient(W / 2 - dx * half, H / 2 - dy * half, W / 2 + dx * half, H / 2 + dy * half);
  colors.stops.forEach(([at, c]) => grad.addColorStop(at, c));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  for (const el of card.querySelectorAll("[data-draw]")) {
    const r = el.getBoundingClientRect();
    const x = (r.left - box.left) * k;
    const y = (r.top - box.top) * k;
    const w = r.width * k;
    const h = r.height * k;
    const style = getComputedStyle(el);
    const kind = el.getAttribute("data-draw");
    if (kind === "glow") {
      const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, w / 2);
      g.addColorStop(0, colors.glow);
      g.addColorStop(1, "transparent");
      ctx.save();
      ctx.globalAlpha = parseFloat(style.opacity) || 0.5;
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else if (kind === "image") {
      const img = await loadImage(el.currentSrc || el.src);
      ctx.save();
      ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
      ctx.shadowBlur = 48 * k * 0.5;
      ctx.shadowOffsetY = 24 * k * 0.5;
      roundRect(ctx, x, y, w, h, parseFloat(style.borderTopLeftRadius) * k);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRect(ctx, x, y, w, h, parseFloat(style.borderTopLeftRadius) * k);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } else {
      const text = el.getAttribute("data-text") || el.textContent;
      const size = parseFloat(style.fontSize) * k;
      const lh = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2) * k;
      ctx.save();
      ctx.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${(parseFloat(style.letterSpacing) || 0) * k}px`;
      ctx.fillStyle = style.color;
      ctx.textBaseline = "middle";
      const words = el.querySelectorAll("[data-w]");
      if (words.length) {
        words.forEach((span) => {
          const wr = span.getBoundingClientRect();
          ctx.fillText(span.getAttribute("data-w"), (wr.left - box.left) * k, (wr.top - box.top + wr.height / 2) * k);
        });
      } else {
        wrap(ctx, text, w + 2 * k).forEach((line, i) => ctx.fillText(line, x, y + lh * (i + 0.5)));
      }
      ctx.restore();
    }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}
