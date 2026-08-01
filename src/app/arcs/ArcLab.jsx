"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { samplePath, scaleAt } from "@/app/psa/flightPath";
import { EASES, PATH_KNOBS, PATH_VARIANTS, easeFn } from "@/app/psa/saveMotion";
import "@/app/psa/psa-kit.css";
import "./arcs.css";

/* ─────────────────────────────────────────────────────────────────────────
   /arcs — the save flight, with the lights on.

   Everything here is drawn from samplePath() in flightPath.js, which is the
   exact function the real flight animates from. A debug view that
   reimplements what it inspects is worse than none: it agrees with you right
   up until the moment you need it not to.

   What it shows, and why each one is here:

     THE PLOT      the curve, its control handles, and the card drawn as a
                   rotated rectangle every few samples. Orientation is a thing
                   you have to SEE against the path — a number in a table
                   cannot tell you they disagree.

     TIME DOTS     samples spaced by TIME, not by distance. Where they bunch
                   up the card is slow; where they string out it is fast. This
                   is the only honest picture of an easing.

     THE CHARTS    speed, angle, and — the one that matters — ANGULAR SPEED.
                   A spike in the turn with no matching spike in the path is
                   the card rotating on its own account, which is exactly what
                   "the rotation and the arc are fighting" looks like as a
                   number.

     SCENARIOS     every real launch position at once. A trip that reads well
                   from the top row can be nonsense from the bottom one,
                   because the shape of the curve depends on the delta, and
                   most of the trouble has come from tuning against one tile.

     WARNINGS      the specific failures we have actually hit, checked for.
   ───────────────────────────────────────────────────────────────────────── */

// The shell being simulated: /psa is a 430px phone with a two-column grid.
const SHELL = { w: 390, h: 760 };
const NAV = { h: 64 };
const PAD = 16;
const GAP = 12;
const CARD_W = (SHELL.w - PAD * 2 - GAP) / 2;
const CARD_H = CARD_W / (14 / 25); // --pk-card-ratio
const ICON = { w: 24, h: 24 };

// Where the Collection tab's icon sits: middle of five columns, in the bar.
const TARGET = { x: SHELL.w / 2, y: SHELL.h - NAV.h + 22 };

/* Real launch positions. The last two are the ones that have caused every
   problem, because their delta is short and mostly vertical — the regime
   where a curve tuned on a long diagonal degenerates. */
const SCENARIOS = [
  { id: "tl", name: "Top left", col: 0, row: 0 },
  { id: "tr", name: "Top right", col: 1, row: 0 },
  { id: "ml", name: "Middle left", col: 0, row: 1 },
  { id: "mr", name: "Middle right", col: 1, row: 1 },
  { id: "bl", name: "Bottom left", col: 0, row: 2 },
  { id: "br", name: "Bottom right", col: 1, row: 2 },
];

function tileBox(s) {
  const x = PAD + s.col * (CARD_W + GAP);
  const y = 96 + s.row * (CARD_H + 64);
  return { x, y, w: CARD_W, h: CARD_H, cx: x + CARD_W / 2, cy: y + CARD_H / 2 };
}

const fmt = (v, step) => {
  const dp = (String(step).split(".")[1] ?? "").length;
  return dp ? Number(v).toFixed(dp) : String(Math.round(v));
};

/* ── Charts ───────────────────────────────────────────────────────────── */
function Chart({ rows, pick, label, unit, zero = false, mark }) {
  const w = 260;
  const h = 64;
  const vals = rows.map(pick);
  const max = Math.max(...vals.map(Math.abs), 0.0001);
  const lo = zero ? -max : Math.min(0, ...vals);
  const hi = max;
  const span = hi - lo || 1;
  const px = (i) => (i / (rows.length - 1)) * w;
  const py = (v) => h - ((v - lo) / span) * h;

  const d = vals.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join("");
  const zeroY = py(0);

  return (
    <figure className="arc-chart">
      <figcaption>
        <span>{label}</span>
        <span className="arc-num">
          {max.toFixed(max < 10 ? 2 : 0)} {unit}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1={zeroY} x2={w} y2={zeroY} className="arc-chart-zero" />
        <path d={d} className="arc-chart-line" />
        {mark != null && <line x1={px(mark)} y1="0" x2={px(mark)} y2={h} className="arc-chart-head" />}
      </svg>
    </figure>
  );
}

/* ── One scenario's plot ──────────────────────────────────────────────── */
function Plot({ scenario, tuning, head, big }) {
  const tile = tileBox(scenario);
  const dx = TARGET.x - tile.cx;
  const dy = TARGET.y - tile.cy;
  const path = useMemo(() => samplePath(dx, dy, tuning, 80), [dx, dy, tuning]);
  const { rows, c1, c2 } = path;

  const abs = (p) => ({ x: tile.cx + p.x, y: tile.cy + p.y });
  const A = abs({ x: 0, y: 0 });
  const B = abs(c1);
  const C = abs(c2);
  const D = abs({ x: dx, y: dy });

  const d = `M${A.x.toFixed(1)},${A.y.toFixed(1)} C${B.x.toFixed(1)},${B.y.toFixed(1)} ${C.x.toFixed(1)},${C.y.toFixed(1)} ${D.x.toFixed(1)},${D.y.toFixed(1)}`;

  // Cards drawn along the way, actually rotated and actually scaled — the
  // only way to see the bank against the path rather than beside it.
  const ghosts = rows.filter((_, i) => i % 10 === 0);
  const at = head == null ? null : rows[Math.round(head * (rows.length - 1))];

  return (
    <div className={`arc-plot${big ? " is-big" : ""}`}>
      <svg viewBox={`0 0 ${SHELL.w} ${SHELL.h}`} role="img" aria-label={`${scenario.name} path`}>
        <rect x="0.5" y="0.5" width={SHELL.w - 1} height={SHELL.h - 1} className="arc-shell" rx="14" />

        {/* the grid it leaves from */}
        {SCENARIOS.map((s) => {
          const t = tileBox(s);
          return (
            <rect
              key={s.id}
              x={t.x}
              y={t.y}
              width={t.w}
              height={t.h}
              rx="8"
              className={`arc-tile${s.id === scenario.id ? " is-from" : ""}`}
            />
          );
        })}

        {/* the footer, solid, and the bookmark it is aiming at */}
        <rect x="0" y={SHELL.h - NAV.h} width={SHELL.w} height={NAV.h} className="arc-nav" />
        <rect
          x={TARGET.x - ICON.w / 2}
          y={TARGET.y - ICON.h / 2}
          width={ICON.w}
          height={ICON.h}
          rx="4"
          className="arc-target"
        />

        {/* control handles: the two numbers that ARE the shape */}
        <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} className="arc-handle" />
        <line x1={D.x} y1={D.y} x2={C.x} y2={C.y} className="arc-handle" />
        <circle cx={B.x} cy={B.y} r="4" className="arc-cp" />
        <circle cx={C.x} cy={C.y} r="4" className="arc-cp" />

        <path d={d} className="arc-curve" />

        {/* cards along the path — rotated and scaled as they really will be */}
        {ghosts.map((r) => {
          const s = scaleAt(r.u, tuning);
          const p = abs(r);
          return (
            <g key={r.u} transform={`translate(${p.x} ${p.y}) rotate(${r.deg}) scale(${s.x} ${s.y})`}>
              <rect
                x={-tile.w / 2}
                y={-tile.h / 2}
                width={tile.w}
                height={tile.h}
                rx="8"
                className="arc-ghost"
              />
              {/* a mark on the bottom edge, so which way is DOWN is legible */}
              <line x1={-tile.w / 2} y1={tile.h / 2} x2={tile.w / 2} y2={tile.h / 2} className="arc-ghost-foot" />
            </g>
          );
        })}

        {/* one dot per equal slice of TIME: bunched is slow, strung out is fast */}
        {rows.map((r) => {
          const p = abs(r);
          return <circle key={`t${r.u}`} cx={p.x} cy={p.y} r="1.4" className="arc-dot" />;
        })}

        {/* the playhead */}
        {at && (
          <g
            transform={`translate(${abs(at).x} ${abs(at).y}) rotate(${at.deg}) scale(${scaleAt(at.u, tuning).x} ${scaleAt(at.u, tuning).y})`}
          >
            <rect
              x={-tile.w / 2}
              y={-tile.h / 2}
              width={tile.w}
              height={tile.h}
              rx="8"
              className="arc-head"
            />
            <line x1={-tile.w / 2} y1={tile.h / 2} x2={tile.w / 2} y2={tile.h / 2} className="arc-head-foot" />
          </g>
        )}
      </svg>
      <span className="arc-plot-name">{scenario.name}</span>
    </div>
  );
}

/* ── What has actually gone wrong before, checked for ─────────────────── */
function audit(rows, tuning, dx, dy) {
  const out = [];
  const deg = rows.map((r) => r.deg);
  const first = deg[0];
  const last = deg[deg.length - 1];

  if (Math.abs(first) > 0.01)
    out.push(["Starts rotated", `${first.toFixed(1)}° on frame one — the clone will not match the tile.`]);
  if (Math.abs(last) > 0.01)
    out.push(["Lands rotated", `${last.toFixed(1)}° at arrival — it goes into the bookmark crooked.`]);

  let jump = 0;
  for (let i = 1; i < deg.length; i += 1) jump = Math.max(jump, Math.abs(deg[i] - deg[i - 1]));
  if (jump > 12)
    out.push(["Angle jumps", `${jump.toFixed(0)}° between adjacent samples — that is a visible flip.`]);

  const peak = Math.max(...deg.map(Math.abs));
  if (peak > 42) out.push(["Lying down", `Peaks at ${peak.toFixed(0)}°. Past ~35° it stops reading as a lean.`]);

  // Does the card leave the shell? Fine on purpose sometimes, worth saying.
  const tile = { cy: TARGET.y - dy };
  const above = rows.some((r) => tile.cy + r.y < -20);
  if (above) out.push(["Leaves the top", "The curve takes it off the top of the screen."]);

  // Angular speed with no matching path speed = rotating on its own account.
  const worst = rows.reduce((a, r) => (Math.abs(r.dps) > Math.abs(a.dps) ? r : a), rows[0]);
  const pathSpeed = worst.px / Math.max(1, Math.hypot(dx, dy));
  if (Math.abs(worst.dps) > 90 && pathSpeed < 1.2)
    out.push([
      "Turn outruns the path",
      `${Math.abs(worst.dps).toFixed(0)}°/unit at u=${worst.u.toFixed(2)} while the card is barely moving.`,
    ]);

  const evenness = Math.max(...rows.map((r) => r.px)) / Math.max(0.001, Math.min(...rows.map((r) => r.px)));
  if (evenness > 12)
    out.push(["Very uneven", `Fastest moment is ${evenness.toFixed(0)}× the slowest. Check the speed curve.`]);

  return out;
}

export default function ArcLab() {
  const [variantId, setVariantId] = useState(PATH_VARIANTS[0].id);
  const [overrides, setOverrides] = useState({});
  const [scenarioId, setScenarioId] = useState("tr");
  const [head, setHead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  const base = PATH_VARIANTS.find((v) => v.id === variantId) ?? PATH_VARIANTS[0];
  const tuning = useMemo(
    () => ({ ...base, ...(overrides[variantId] ?? {}) }),
    [base, overrides, variantId],
  );
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const tile = tileBox(scenario);
  const dx = TARGET.x - tile.cx;
  const dy = TARGET.y - tile.cy;
  const { rows } = useMemo(() => samplePath(dx, dy, tuning, 80), [dx, dy, tuning]);
  const problems = useMemo(() => audit(rows, tuning, dx, dy), [rows, tuning, dx, dy]);

  // Playback at the variant's real duration, so what you watch is the speed
  // it actually runs at rather than a convenient one.
  useEffect(() => {
    if (!playing) return undefined;
    let start = null;
    const step = (now) => {
      if (start === null) start = now;
      const u = (now - start) / tuning.duration;
      if (u >= 1) {
        setHead(1);
        setPlaying(false);
        return;
      }
      setHead(u);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, tuning.duration]);

  const set = (key, value) =>
    setOverrides((o) => ({ ...o, [variantId]: { ...(o[variantId] ?? {}), [key]: value } }));

  const play = () => {
    setHead(0);
    setPlaying(true);
  };

  return (
    <main className="pk arcs" data-lenis-prevent>
      <header className="arc-head-bar">
        <h1 className="t-head-xl">Arcs</h1>
        <p className="t-body-sm arc-sub">
          Drawn from the same samplePath() the real flight animates from. If it looks wrong here it
          is wrong there.
        </p>
      </header>

      <div className="arc-body">
        {/* ── left: the big plot and playback ───────────────────────── */}
        <section className="arc-stage">
          <div className="arc-chips">
            {PATH_VARIANTS.map((v) => (
              <button
                key={v.id}
                type="button"
                className="arc-chip"
                data-on={v.id === variantId || undefined}
                onClick={() => setVariantId(v.id)}
              >
                {v.name}
              </button>
            ))}
          </div>
          <div className="arc-chips">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className="arc-chip"
                data-on={s.id === scenarioId || undefined}
                onClick={() => setScenarioId(s.id)}
              >
                {s.name}
              </button>
            ))}
          </div>

          <Plot scenario={scenario} tuning={tuning} head={head} big />

          <div className="arc-transport">
            <button type="button" className="arc-btn" onClick={play}>
              {playing ? "Playing" : "Play"}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.005"
              value={head}
              onChange={(e) => {
                setPlaying(false);
                setHead(Number(e.target.value));
              }}
            />
            <span className="arc-num">
              {Math.round(head * tuning.duration)} / {tuning.duration} ms
            </span>
          </div>
        </section>

        {/* ── right: readouts ───────────────────────────────────────── */}
        <section className="arc-side">
          <div className="arc-panel">
            <h2 className="arc-h">Rates</h2>
            <Chart rows={rows} pick={(r) => r.px} label="Speed" unit="px" mark={head * (rows.length - 1)} />
            <Chart rows={rows} pick={(r) => r.deg} label="Bank" unit="°" zero mark={head * (rows.length - 1)} />
            <Chart
              rows={rows}
              pick={(r) => r.dps}
              label="Turn rate"
              unit="°/u"
              zero
              mark={head * (rows.length - 1)}
            />
            <p className="arc-note">
              A spike in turn rate without one in speed is the card rotating on its own account —
              that is what &ldquo;fighting the arc&rdquo; looks like as a number.
            </p>
          </div>

          <div className="arc-panel">
            <h2 className="arc-h">Checks</h2>
            {problems.length === 0 ? (
              <p className="arc-ok">Nothing flagged for this scenario.</p>
            ) : (
              <ul className="arc-problems">
                {problems.map(([title, why]) => (
                  <li key={title}>
                    <strong>{title}</strong>
                    <span>{why}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="arc-panel">
            <h2 className="arc-h">Tuning</h2>
            {PATH_KNOBS.map((sec) => (
              <details className="arc-sec" key={sec.section} open={sec.section === "The curve"}>
                <summary>{sec.section}</summary>
                <div className="arc-sec-body">
                  {sec.rows.map((row) => {
                    const value = tuning[row.key];
                    if (row.type === "ease")
                      return (
                        <label className="arc-knob" key={row.key}>
                          <span className="arc-knob-head">{row.label}</span>
                          <select value={value} onChange={(e) => set(row.key, e.target.value)}>
                            {EASES.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.id}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    if (row.type === "seg")
                      return (
                        <div className="arc-knob" key={row.key}>
                          <span className="arc-knob-head">{row.label}</span>
                          <div className="arc-seg">
                            {row.options.map((o) => (
                              <button
                                key={o.id}
                                type="button"
                                data-on={value === o.id || undefined}
                                onClick={() => set(row.key, o.id)}
                              >
                                {o.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    return (
                      <label className="arc-knob" key={row.key}>
                        <span className="arc-knob-head">
                          {row.label}
                          <span className="arc-num">
                            {fmt(value, row.step)} {row.unit}
                          </span>
                        </span>
                        <input
                          type="range"
                          min={row.min}
                          max={row.max}
                          step={row.step}
                          value={value}
                          onChange={(e) => set(row.key, Number(e.target.value))}
                        />
                      </label>
                    );
                  })}
                </div>
              </details>
            ))}
            <button
              type="button"
              className="arc-btn"
              onClick={() => setOverrides((o) => ({ ...o, [variantId]: undefined }))}
            >
              Reset {base.name}
            </button>
          </div>
        </section>
      </div>

      {/* ── every launch position at once ───────────────────────────── */}
      <section className="arc-all">
        <h2 className="arc-h">
          Every launch position, same numbers
          <span className="arc-note-inline">
            The delta is different from every tile, so the curve is a different shape from every
            tile. Tuning against one of these is how the others end up wrong.
          </span>
        </h2>
        <div className="arc-grid">
          {SCENARIOS.map((s) => (
            <Plot key={s.id} scenario={s} tuning={tuning} head={head} />
          ))}
        </div>
      </section>
    </main>
  );
}
