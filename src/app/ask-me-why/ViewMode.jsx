"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

const BASE = 100;
const MIN_PX = 22;
const MAX_PX = 168;
const RIDER = 38;
const EXIT_MS = 220;

const stamp = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const ViewMode = forwardRef(function ViewMode(
  {
    lines,
    cast,
    colors,
    secondary,
    liveSingers,
    clockMs,
    durationMs,
    onExit,
    onToggle,
    onSeek,
    playing,
  },
  ref,
) {
  const [sizes, setSizes] = useState([]);
  const [active, setActive] = useState(-1);
  const [pills, setPills] = useState([]);
  const [hud, setHud] = useState(false);

  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const lineRefs = useRef([]);
  const riderRefs = useRef({});
  const activeRef = useRef(-1);
  const liveRef = useRef("");
  const timersRef = useRef({});
  const pillsRef = useRef([]);
  const hudRef = useRef(false);
  const singersRef = useRef([]);
  singersRef.current = liveSingers || [];

  const measure = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !lines.length) return;
    const width = stage.clientWidth - 48;
    if (width <= 0) return;

    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `600 ${BASE}px ${getComputedStyle(stage).fontFamily}`;

    setSizes(
      lines.map((line) => {
        const w = probe.measureText(line.text || "♪").width || 1;
        return Math.max(MIN_PX, Math.min(MAX_PX, (width / w) * BASE));
      }),
    );
  }, [lines]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [measure]);

  const placeRiders = useCallback((index, wordIndex, progress) => {
    const lineNode = lineRefs.current[index];
    if (!lineNode) return;

    const word = wordIndex >= 0 ? lineNode.querySelector(`[data-w="${wordIndex}"]`) : null;
    if (!word) return;

    const fillX = word.offsetLeft + word.offsetWidth * progress;
    const list = singersRef.current;
    const gap = RIDER * 0.92;
    const spread = (list.length - 1) * gap;

    const seats = list.map((id, i) => ({ id, x: fillX - RIDER / 2 - spread / 2 + i * gap }));
    for (let i = 1; i < seats.length; i++) {
      if (seats[i].x - seats[i - 1].x < gap) seats[i].x = seats[i - 1].x + gap;
    }

    for (const seat of seats) {
      const node = riderRefs.current[`${index}:${seat.id}`];
      if (!node) continue;
      const x = Math.round(seat.x);
      if (node.__x === x) continue;
      node.__x = x;
      node.style.transform = `translate3d(${x}px, 0, 0)`;
    }
  }, []);

  const paint = useCallback(
    (cueMs, index, bins) => {
      const stage = stageRef.current;
      if (stage && bins) {
        const top = Math.floor(bins.length * 0.5);
        let sum = 0;
        for (let i = 0; i < top; i++) sum += bins[i];
        const level = Math.round((sum / top / 255) * 24) / 24;
        if (stage.__v !== level) {
          stage.__v = level;
          stage.style.setProperty("--vol", level);
        }
      }

      if (index !== activeRef.current) {
        const stale = lineRefs.current[activeRef.current];
        if (stale) {
          for (const g of stale.querySelectorAll("[data-s]")) {
            g.__p = 0;
            g.style.setProperty("--p", 0);
          }
        }
        activeRef.current = index;
        setActive(index);
        lineRefs.current[index]?.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      const node = lineRefs.current[index];
      let current = -1;
      let progress = 0;
      if (node) {
        for (const g of node.querySelectorAll("[data-s]")) {
          const s = +g.dataset.s;
          const e = +g.dataset.e;
          const p = Math.min(1, Math.max(0, (cueMs - s) / Math.max(1, e - s)));
          const q = Math.round(p * 30) / 30;
          if (g.__p !== q) {
            g.__p = q;
            g.style.setProperty("--p", q);
          }
        }
        const words = lines[index]?.words || [];
        for (let k = 0; k < words.length; k++) {
          if (!words[k].text.trim()) continue;
          if (cueMs >= words[k].start) current = k;
        }
        if (current >= 0) {
          const w = words[current];
          const dur = Math.max(1, (w.end ?? w.start + 220) - w.start);
          progress = Math.min(1, Math.max(0, (cueMs - w.start) / dur));
        }
      }
      placeRiders(index, current, progress);

      const now = (secondary || [])
        .filter((x) => cueMs >= x.start && cueMs <= x.end)
        .map((x) => x.id)
        .join("|");

      if (now !== liveRef.current) {
        liveRef.current = now;
        const ids = now ? now.split("|") : [];

        setPills((prev) => {
          const kept = prev.map((p) => ({ ...p, on: ids.includes(p.id) }));
          for (const id of ids) {
            if (!kept.some((p) => p.id === id)) {
              const seg = (secondary || []).find((x) => x.id === id);
              if (seg) kept.push({ id, seg, on: true });
            }
          }
          return kept;
        });

        for (const id of Object.keys(timersRef.current)) {
          if (ids.includes(id)) {
            clearTimeout(timersRef.current[id]);
            delete timersRef.current[id];
          }
        }
        for (const p of pillsRef.current) {
          if (!ids.includes(p.id) && !timersRef.current[p.id]) {
            timersRef.current[p.id] = setTimeout(() => {
              delete timersRef.current[p.id];
              setPills((cur) => cur.filter((x) => x.id !== p.id));
            }, EXIT_MS);
          }
        }
      }
    },
    [lines, secondary, placeRiders],
  );

  pillsRef.current = pills;
  hudRef.current = hud;

  useImperativeHandle(ref, () => ({ paint }), [paint]);

  useEffect(() => {
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && (e.key === "k" || e.key === ".")) {
        e.preventDefault();
        setHud((h) => !h);
        return;
      }
      if (e.key === "Escape") {
        if (hudRef.current) setHud(false);
        else onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  useEffect(
    () => () => {
      for (const t of Object.values(timersRef.current)) clearTimeout(t);
    },
    [],
  );

  const singing = new Set(liveSingers || []);

  return (
    <div className="vm" ref={stageRef}>
      <div className="vm-scroll">
        <div className="vm-content" ref={contentRef}>
          <div className="vm-pad" />
          {lines.map((line, i) => (
            <div
              key={i}
              ref={(el) => (lineRefs.current[i] = el)}
              className="vm-line"
              data-on={active === i}
              style={{ fontSize: `${sizes[i] || 40}px` }}
            >
              <span className="vm-crew" aria-hidden="true">
                {cast.map((member, k) => (
                  <span
                    key={member.id}
                    ref={(el) => (riderRefs.current[`${i}:${member.id}`] = el)}
                    className="vm-rider"
                    data-on={active === i && singing.has(member.id)}
                    style={{ "--agent": member.color, "--k": k }}
                  >
                    <span className="vm-shell">
                      <span className="vm-bob">
                        <span className="vm-ride">
                          <img src={`/cast/${member.id}.webp`} alt="" />
                        </span>
                      </span>
                    </span>
                  </span>
                ))}
              </span>

              <span className="vm-text">
                {line.words?.length
                  ? line.words.map((w, wi) => {
                      if (!w.text.trim()) return <span key={wi}>{w.text}</span>;
                      const lead = w.singers?.[0] ? colors[w.singers[0]] : null;
                      const dur = Math.max(1, (w.end ?? w.start + 220) - w.start);
                      const glyphs = [...w.text];
                      return (
                        <span
                          key={wi}
                          className="vm-word"
                          data-w={wi}
                          onClick={() => onSeek?.(w.start)}
                          style={lead ? { "--agent": lead.color } : undefined}
                        >
                          {glyphs.map((ch, ci) => (
                            <span
                              key={ci}
                              className="vm-g"
                              data-s={Math.round(w.start + (dur * ci) / glyphs.length)}
                              data-e={Math.round(w.start + (dur * (ci + 1)) / glyphs.length)}
                              style={{ "--p": 0 }}
                            >
                              {ch}
                            </span>
                          ))}
                        </span>
                      );
                    })
                  : line.text || "♪"}
              </span>
            </div>
          ))}
          <div className="vm-pad" />

        </div>
      </div>

      <div className="vm-secondary">
        {pills.map((p) => (
          <span
            key={p.id}
            className="vm-seg"
            data-on={p.on}
            style={{ "--agent": colors[p.seg.singer]?.color || "var(--neutral-500)" }}
          >
            <span className="vm-seg-in">
              {p.seg.singer ? <img src={`/cast/${p.seg.singer}.webp`} alt="" /> : null}
              {p.seg.text || "ooh"}
            </span>
          </span>
        ))}
      </div>

      <div className="vm-hud" data-on={hud} onClick={() => setHud(false)}>
        <div className="vm-hud-panel" onClick={(e) => e.stopPropagation()}>
          <span className="vm-hud-clock">
            {stamp(clockMs)}
            <span className="vm-hud-of">/ {stamp(durationMs)}</span>
          </span>

          <div className="vm-hud-row">
            <button className="vm-hud-btn" data-primary onClick={onToggle}>
              {playing ? "Pause" : "Play"}
              <span className="cast-key">space</span>
            </button>
            <button className="vm-hud-btn" onClick={onExit}>
              Leave view mode
              <span className="cast-key">esc</span>
            </button>
          </div>

          <p className="vm-hud-hint">Click any word to jump there. ⌘K to hide this.</p>
        </div>
      </div>

    </div>
  );
});

export default ViewMode;
