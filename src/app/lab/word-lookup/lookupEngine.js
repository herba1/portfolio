const DAMPING = 0.9;
const tune = (response) => ({ stiff: (2 * Math.PI / response) ** 2, damp: (4 * Math.PI * DAMPING) / response });
const OPEN = tune(0.34);
const CLOSE = tune(0.24);
const KEYS = ["x", "y", "w", "h", "mx", "my", "mw"];

export function createLookupEngine({ layer, body, mark, onClosed }) {
  const value = {};
  const velocity = {};
  const target = {};
  for (const key of KEYS) {
    value[key] = 0;
    velocity[key] = 0;
    target[key] = 0;
  }
  let sheetW = 0;
  let sheetH = 0;
  let open = false;
  let shown = false;
  let raf = 0;
  let lastAlpha = -1;
  let spring = OPEN;
  let last = 0;
  let alive = true;
  const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const paint = () => {
    const x = value.x;
    const y = value.y;
    const w = Math.max(0, value.w);
    const h = Math.max(0, value.h);
    const r = Math.max(0, Math.min(12, w / 2, h / 2));
    const right = Math.max(0, sheetW - x - w);
    const bottom = Math.max(0, sheetH - y - h);
    layer.style.clipPath = `inset(${y.toFixed(2)}px ${right.toFixed(2)}px ${bottom.toFixed(2)}px ${x.toFixed(2)}px round ${r.toFixed(2)}px)`;
    body.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
    const alpha = Math.max(0, Math.min(1, (h - 2) / 48));
    if (alpha !== lastAlpha) {
      lastAlpha = alpha;
      layer.style.opacity = alpha.toFixed(3);
    }
    mark.style.transform = `translate3d(${value.mx.toFixed(2)}px, ${value.my.toFixed(2)}px, 0) scaleX(${(Math.max(0, value.mw) / 100).toFixed(4)})`;
  };

  const settled = () => KEYS.every((key) => Math.abs(target[key] - value[key]) < 0.05 && Math.abs(velocity[key]) < 0.05);

  const frame = (now) => {
    raf = 0;
    if (!alive) return;
    const dt = Math.min(0.064, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let s = 0; s < steps; s += 1) {
      for (const key of KEYS) {
        const a = -spring.stiff * (value[key] - target[key]) - spring.damp * velocity[key];
        velocity[key] += a * h;
        value[key] += velocity[key] * h;
      }
    }
    if (settled()) {
      for (const key of KEYS) {
        value[key] = target[key];
        velocity[key] = 0;
      }
      paint();
      last = 0;
      if (!open) {
        shown = false;
        layer.dataset.shown = "false";
        onClosed?.();
      }
      return;
    }
    paint();
    raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (reduced) {
      for (const key of KEYS) {
        value[key] = target[key];
        velocity[key] = 0;
      }
      paint();
      if (!open) {
        shown = false;
        layer.dataset.shown = "false";
        onClosed?.();
      }
      return;
    }
    if (!raf && alive) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  };

  return {
    setSheet(width, height) {
      sheetW = width;
      sheetH = height;
      if (shown) paint();
    },
    show({ card, origin, word }) {
      if (!shown || (!open && value.h < 48)) {
        value.x = origin.x;
        value.y = origin.y;
        value.w = origin.w;
        value.h = origin.h;
        value.mx = word.x + word.w / 2;
        value.my = word.y + word.h + 1;
        value.mw = 0;
        for (const key of KEYS) velocity[key] = 0;
        shown = true;
        layer.dataset.shown = "true";
      }
      open = true;
      spring = OPEN;
      target.x = card.x;
      target.y = card.y;
      target.w = card.w;
      target.h = card.h;
      target.mx = word.x;
      target.my = word.y + word.h + 1;
      target.mw = word.w;
      paint();
      kick();
    },
    resize(card) {
      target.h = card.h;
      target.y = card.y;
      kick();
    },
    hide({ origin, word }) {
      if (!shown) return;
      open = false;
      spring = CLOSE;
      target.x = origin.x;
      target.y = origin.y;
      target.w = origin.w;
      target.h = origin.h;
      target.mx = word.x + word.w / 2;
      target.my = word.y + word.h + 1;
      target.mw = 0;
      kick();
    },
    isOpen: () => open,
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
    },
  };
}
