const W = 72;
const H = 48;
const BLOBS = [
  { c: 0, ax: 0.32, ay: 0.28, fx: 0.071, fy: 0.053, ph: 0.4, r: 0.62 },
  { c: 1, ax: 0.36, ay: 0.3, fx: 0.049, fy: 0.067, ph: 2.1, r: 0.58 },
  { c: 2, ax: 0.3, ay: 0.34, fx: 0.061, fy: 0.043, ph: 4.0, r: 0.5 },
  { c: 3, ax: 0.38, ay: 0.26, fx: 0.039, fy: 0.058, ph: 5.3, r: 0.56 },
  { c: 0, ax: 0.28, ay: 0.36, fx: 0.057, fy: 0.035, ph: 3.2, r: 0.44 },
];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const rgba = (c, a) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])} / ${a})`;

export function createMesh(canvas) {
  const g = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  let from = null;
  let to = null;
  let base = null;
  let fade = 1;
  let pulse = 0;
  let raf = 0;
  let last = 0;
  let seen = true;
  const started = performance.now();

  const colorsAt = () => to.map((c, i) => mix(from[i], c, fade));

  const draw = (now) => {
    const t = (now - started) / 1000;
    const colors = colorsAt();
    g.globalCompositeOperation = "source-over";
    g.fillStyle = rgba(mix(base.from, base.to, fade), 1);
    g.fillRect(0, 0, W, H);
    for (const b of BLOBS) {
      const x = (0.5 + b.ax * Math.sin(t * b.fx * 6.283 + b.ph)) * W;
      const y = (0.5 + b.ay * Math.cos(t * b.fy * 6.283 + b.ph * 1.3)) * H;
      const r = b.r * W * (1 + pulse * 0.14);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      const c = colors[b.c];
      grad.addColorStop(0, rgba(c, 0.95));
      grad.addColorStop(0.35, rgba(c, 0.7));
      grad.addColorStop(0.7, rgba(c, 0.22));
      grad.addColorStop(1, rgba(c, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
  };

  const tick = (now) => {
    raf = 0;
    if (!seen || document.hidden || !to) return;
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    if (now - last < 30 && fade >= 1) {
      raf = requestAnimationFrame(tick);
      return;
    }
    last = now;
    fade = Math.min(1, fade + dt / 1.4);
    pulse *= Math.exp(-dt * 3);
    draw(now);
    raf = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (!raf) raf = requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    wake();
  });
  io.observe(canvas);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);

  return {
    setPalette(colors, ground) {
      if (!to) {
        from = colors;
        to = colors;
        base = { from: ground, to: ground };
        fade = 1;
      } else {
        from = colorsAt();
        base = { from: mix(base.from, base.to, fade), to: ground };
        to = colors;
        fade = 0;
      }
      wake();
    },
    kick(amount) {
      pulse = Math.max(pulse, amount);
    },
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
