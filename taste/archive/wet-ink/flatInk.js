import { PAPER_HEX } from "./wetInkParams";

const HISTORY_LIMIT = 24000;

function linearToHex(linear) {
  return `rgb(${linear
    .map((c) => {
      const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, s)) * 255);
    })
    .join(",")})`;
}

export default class FlatInk {
  static create(canvas) {
    const ctx = canvas.getContext("2d");
    return ctx ? new FlatInk(canvas, ctx) : null;
  }

  constructor(canvas, ctx) {
    this.kind = "flat";
    this.canvas = canvas;
    this.ctx = ctx;
    this.simWidth = 0;
    this.simHeight = 0;
    this.history = [];
    this.inkSource = null;
    this.inkStyle = "rgb(29,39,64)";
    this.paperStyle = PAPER_HEX;
  }

  resize(width, height) {
    this.simWidth = width;
    this.simHeight = height;
  }

  setDisplaySize(width, height) {
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.redraw();
  }

  drawSegment(ax, ay, bx, by, ra, rb, style) {
    const ctx = this.ctx;
    const scale = this.canvas.width / Math.max(1, this.simWidth);
    ctx.strokeStyle = style;
    ctx.lineWidth = Math.max(0.8, (ra + rb) * scale);
    ctx.beginPath();
    ctx.moveTo(ax * scale, ay * scale);
    ctx.lineTo(bx * scale + 0.01, by * scale);
    ctx.stroke();
  }

  redraw() {
    const ctx = this.ctx;
    ctx.fillStyle = this.paperStyle;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineCap = "round";
    for (const s of this.history) this.drawSegment(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
  }

  styleFor(ink) {
    if (ink !== this.inkSource) {
      this.inkSource = ink;
      this.inkStyle = linearToHex(ink);
    }
    return this.inkStyle;
  }

  stamp(segments, nibs, count, settings) {
    const style = this.styleFor(settings.ink);
    this.ctx.lineCap = "round";
    for (let i = 0; i < count; i += 1) {
      const s = [segments[i * 4], segments[i * 4 + 1], segments[i * 4 + 2], segments[i * 4 + 3], nibs[i * 4], nibs[i * 4 + 1], style];
      if (this.history.length < HISTORY_LIMIT) this.history.push(s);
      this.drawSegment(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
    }
  }

  step() {}

  clearTint() {}

  lift(front, feather, keep) {
    if (keep[2] > 0.5) return;
    const edge = Math.max(0, Math.min(1, front - feather * 0.5));
    if (edge >= 1) {
      this.history = [];
      this.redraw();
      return;
    }
    const ctx = this.ctx;
    ctx.fillStyle = this.paperStyle;
    ctx.fillRect(0, 0, this.canvas.width * edge, this.canvas.height);
  }

  wash({ dt, flow, fade }) {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const drop = Math.round(height * flow * dt);
    ctx.fillStyle = this.paperStyle;
    if (drop > 0 && drop < height) {
      ctx.drawImage(this.canvas, 0, 0, width, height - drop, 0, drop, width, height - drop);
      ctx.fillRect(0, 0, width, drop);
    }
    ctx.globalAlpha = 1 - Math.exp(-dt * (fade + 0.6));
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  render() {}

  destroy() {
    this.history = [];
  }
}
