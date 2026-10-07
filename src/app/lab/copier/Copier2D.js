import { SHEET_HEIGHT, SHEET_WIDTH } from "./copierParams";

const FILTERS = [
  "grayscale(1) contrast(3.4) brightness(1.12)",
  "grayscale(1) sepia(1) hue-rotate(280deg) saturate(3) contrast(2.6) brightness(1.1)",
  "grayscale(1) contrast(4) brightness(1.18) sepia(0.25)",
  "grayscale(1) sepia(1) hue-rotate(190deg) saturate(2.4) contrast(1.8) brightness(1.05)",
];

function rgbString(rgb) {
  return `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
}

export function createCopier2D(canvas) {
  const context = canvas.getContext("2d");
  if (!context) return null;
  return new Copier2D(canvas, context);
}

class Copier2D {
  constructor(canvas, context) {
    this.kind = "canvas2d";
    this.canvas = canvas;
    this.context = context;
    this.source = null;
    this.copy = document.createElement("canvas");
    this.copy.width = SHEET_WIDTH;
    this.copy.height = SHEET_HEIGHT;
    this.copyContext = this.copy.getContext("2d");
    this.onRestored = null;
  }

  resize(width, height) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  uploadSource(image, width, height) {
    this.source = { image, width, height };
  }

  resetRows() {
    this.copyContext.setTransform(1, 0, 0, 1, 0, 0);
    this.copyContext.clearRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
  }

  writeRows(ledger, fromRow, toRow, frame) {
    if (!this.source || !frame) return;
    const ctx = this.copyContext;
    const { image } = this.source;
    ctx.save();
    for (let row = fromRow; row < toRow; row += 1) {
      const i = row * 4;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, row, SHEET_WIDTH, 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, row, SHEET_WIDTH, 1);
      ctx.clip();
      ctx.translate(ledger[i], ledger[i + 1]);
      ctx.rotate(ledger[i + 2]);
      ctx.scale(ledger[i + 3], ledger[i + 3]);
      ctx.drawImage(image, -frame.baseWidth / 2, -frame.baseHeight / 2, frame.baseWidth, frame.baseHeight);
      ctx.restore();
    }
    ctx.restore();
  }

  render(frame) {
    const ctx = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const scale = width / SHEET_WIDTH;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgbString(frame.platen);
    ctx.fillRect(0, 0, width, height);
    if (this.source) {
      ctx.save();
      ctx.globalAlpha = frame.appear;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.translate(frame.poseX, frame.poseY);
      ctx.rotate(frame.poseAngle);
      ctx.scale(frame.poseScale, frame.poseScale);
      ctx.drawImage(this.source.image, -frame.baseWidth / 2, -frame.baseHeight / 2, frame.baseWidth, frame.baseHeight);
      ctx.restore();
    }
    const printed = Math.floor(frame.printed);
    if (printed > 0) this.drawCopy(ctx, frame, printed, width, printed * scale);
    if (frame.lampGlow > 0.01) {
      const y = frame.lamp * scale;
      const half = 12 * scale * frame.pxPerCss;
      const glow = ctx.createLinearGradient(0, y - half, 0, y + half);
      const a = frame.lampGlow;
      glow.addColorStop(0, "rgba(204, 246, 229, 0)");
      glow.addColorStop(0.3, `rgba(204, 246, 229, ${0.35 * a})`);
      glow.addColorStop(0.47, `rgba(255, 255, 255, ${0.9 * a})`);
      glow.addColorStop(0.53, `rgba(255, 255, 255, ${0.9 * a})`);
      glow.addColorStop(0.7, `rgba(204, 246, 229, ${0.35 * a})`);
      glow.addColorStop(1, "rgba(204, 246, 229, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, y - half, width, half * 2);
    }
  }

  drawCopy(ctx, frame, rows, width, height) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgbString(frame.paper);
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "multiply";
    ctx.filter = FILTERS[frame.preset] ?? FILTERS[0];
    ctx.drawImage(this.copy, 0, 0, SHEET_WIDTH, rows, 0, 0, width, height);
    ctx.restore();
  }

  bake(frame) {
    const sheet = document.createElement("canvas");
    sheet.width = SHEET_WIDTH;
    sheet.height = SHEET_HEIGHT;
    this.drawCopy(sheet.getContext("2d"), frame, SHEET_HEIGHT, SHEET_WIDTH, SHEET_HEIGHT);
    return sheet;
  }

  dispose() {
    this.source = null;
    this.copy.width = 0;
    this.copy.height = 0;
  }
}
