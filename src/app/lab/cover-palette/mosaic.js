const LEVELS = [1, 2, 3, 4, 6, 8, 11, 15, 20, 26, 34];
const UP = 380;
const DOWN = 560;

export function createMosaic(canvas) {
  const ctx = canvas.getContext("2d");
  const small = document.createElement("canvas");
  const sctx = small.getContext("2d");
  let shown = null;
  let next = null;
  let phase = "idle";
  let t = 0;
  let raf = 0;
  let last = 0;
  let width = 0;
  let height = 0;
  let ratio = 1;
  let drawn = "";
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const blockAt = (k) => LEVELS[Math.round(Math.min(1, Math.max(0, k)) * (LEVELS.length - 1))];

  const draw = (img, block) => {
    if (!width || !height) return;
    const key = `${img?.src}|${block}|${width}|${height}`;
    if (key === drawn) return;
    drawn = key;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!img || !img.naturalWidth) return;
    if (block <= 1) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return;
    }
    const cols = Math.max(1, Math.ceil(width / block));
    const rows = Math.max(1, Math.ceil(height / block));
    small.width = cols;
    small.height = rows;
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(img, 0, 0, cols, rows);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, cols, rows, 0, 0, cols * block * ratio, rows * block * ratio);
  };

  const ease = (x) => x * x * (3 - 2 * x);

  const frame = (now) => {
    raf = 0;
    const dt = last ? now - last : 16;
    last = now;
    if (phase === "up") {
      t = Math.min(1, t + dt / UP);
      draw(shown, blockAt(ease(t)));
      if (t >= 1) {
        shown = next;
        next = null;
        phase = "down";
        drawn = "";
        draw(shown, blockAt(1));
      }
    } else if (phase === "down") {
      t = Math.max(0, t - dt / DOWN);
      draw(shown, blockAt(ease(t)));
      if (t <= 0) {
        phase = "idle";
        last = 0;
        return;
      }
    }
    if (phase !== "idle") raf = requestAnimationFrame(frame);
    else last = 0;
  };

  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  return {
    resize(w, h, r) {
      width = w;
      height = h;
      ratio = r;
      canvas.width = Math.round(w * r);
      canvas.height = Math.round(h * r);
      drawn = "";
      draw(shown, phase === "idle" ? 1 : blockAt(ease(t)));
    },
    show(img, instant = false) {
      if (!shown || instant || reduce) {
        shown = img;
        next = null;
        phase = "idle";
        t = 0;
        drawn = "";
        draw(shown, 1);
        return;
      }
      if (phase === "idle" || phase === "down") {
        if (phase === "idle" && img === shown) return;
        if (phase === "down" && img === shown) return;
        next = img;
        phase = "up";
        kick();
        return;
      }
      next = img;
    },
    redraw() {
      drawn = "";
      draw(shown, phase === "idle" ? 1 : blockAt(ease(t)));
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
