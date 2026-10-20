export const PAPER = [238, 235, 228];
const INK = "rgb(20 20 22)";
const VERMILION = "rgb(232 70 34)";
const COBALT = "rgb(36 64 196)";

export function paintPoster(canvas, { width, height, scale, family }) {
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = `rgb(${PAPER[0]} ${PAPER[1]} ${PAPER[2]})`;
  ctx.fillRect(0, 0, width, height);

  const narrow = width < 640;
  const left = narrow ? 16 : Math.max(48, width * 0.06);

  const discR = narrow ? width * 0.36 : Math.min(height * 0.3, width * 0.2);
  const discX = narrow ? width * 0.62 : width * 0.64;
  const discY = narrow ? height * 0.42 : height * 0.4;
  ctx.fillStyle = VERMILION;
  ctx.beginPath();
  ctx.arc(discX, discY, discR, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = COBALT;
  const barW = narrow ? width * 0.1 : width * 0.045;
  ctx.fillRect(discX + discR * 0.62, narrow ? height * 0.18 : height * 0.12, barW, narrow ? height * 0.34 : height * 0.5);

  const words = ["slow", "light"];
  const probe = 100;
  ctx.font = `600 ${probe}px ${family}`;
  const widest = Math.max(...words.map((w) => ctx.measureText(w).width));
  const size = Math.min(((width - left * 2) * (narrow ? 0.98 : 0.66) * probe) / widest, height * (narrow ? 0.2 : 0.34));
  ctx.font = `600 ${size}px ${family}`;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  const lead = size * 0.86;
  const base = height - (narrow ? 112 : 56) - size * 0.12;
  ctx.fillText(words[0], left - size * 0.04, base - lead);
  ctx.fillText(words[1], left - size * 0.04, base);

  ctx.fillStyle = INK;
  ctx.fillRect(left, base - lead - size * 0.86, narrow ? width - left * 2 : width * 0.3, Math.max(1.5, size * 0.012));
}
