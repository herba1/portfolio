const RADIUS = 76;
const GAIN = 1.5;

export function createLens(grid) {
  let tiles = [];
  let centers = [];
  let touched = new Set();
  let raf = 0;
  let point = null;

  const measure = () => {
    tiles = [...grid.querySelectorAll("[data-day]")];
    centers = tiles.map((el) => [el.offsetLeft + el.offsetWidth / 2, el.offsetTop + el.offsetHeight / 2]);
  };

  const paint = () => {
    raf = 0;
    const next = new Set();
    if (point) {
      const [px, py] = point;
      for (let i = 0; i < tiles.length; i += 1) {
        const dx = centers[i][0] - px;
        const dy = centers[i][1] - py;
        if (Math.abs(dx) > RADIUS || Math.abs(dy) > RADIUS) continue;
        const d = Math.hypot(dx, dy);
        if (d > RADIUS) continue;
        const f = (1 - d / RADIUS) ** 2;
        const push = 1 + f * 0.35;
        tiles[i].style.setProperty("--lens", (1 + f * GAIN).toFixed(3));
        tiles[i].style.setProperty("--lx", `${(dx * (push - 1)).toFixed(2)}px`);
        tiles[i].style.setProperty("--ly", `${(dy * (push - 1)).toFixed(2)}px`);
        tiles[i].style.zIndex = String(10 + Math.round(f * 50));
        next.add(i);
      }
    }
    for (const i of touched) {
      if (next.has(i)) continue;
      tiles[i].style.removeProperty("--lens");
      tiles[i].style.removeProperty("--lx");
      tiles[i].style.removeProperty("--ly");
      tiles[i].style.zIndex = "";
    }
    touched = next;
  };

  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };

  const onMove = (e) => {
    if (e.pointerType !== "mouse") return;
    const r = grid.getBoundingClientRect();
    point = [e.clientX - r.left, e.clientY - r.top];
    schedule();
  };

  const onLeave = () => {
    point = null;
    schedule();
  };

  const ro = new ResizeObserver(measure);
  ro.observe(grid);
  measure();
  grid.addEventListener("pointermove", onMove);
  grid.addEventListener("pointerleave", onLeave);

  return {
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerleave", onLeave);
    },
  };
}
