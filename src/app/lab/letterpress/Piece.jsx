"use client";

import { useEffect, useRef, useState } from "react";

import "./letterpress.css";

const DEFAULT_TITLE = "Side A";
const FACES = [
  { id: "gothic", label: "Gothic" },
  { id: "italic", label: "Italic" },
];
const STAGE_LABEL =
  "A tabletop platen press with a line of wood type locked in the chase. Drag the brayer across the type to ink it; slow passes lay down more ink. Pull the lever down to close the platen and print; the harder the pull, the deeper the bite. Type to set a new title, Backspace removes a letter, the arrow keys roll the brayer, and Enter pulls a print.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const headRef = useRef(null);
  const panelRef = useRef(null);
  const engineRef = useRef(null);
  const textRef = useRef(DEFAULT_TITLE);
  const faceRef = useRef("gothic");
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [face, setFace] = useState("gothic");
  const [status, setStatus] = useState("loading");
  const [info, setInfo] = useState({ ink: 0, pulled: 0, word: "", pressing: false });

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const insets = () => {
      if (embedded) return { top: 16, right: 16, bottom: 16, left: 16 };
      const box = root.getBoundingClientRect();
      if (box.width >= 900) return { top: 92, right: 40, bottom: 40, left: 300 };
      const head = headRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 8 : 140;
      const bottom = panel ? box.bottom - panel.top + 8 : 120;
      return { top, right: 12, bottom, left: 12 };
    };
    const start = async () => {
      started = true;
      try {
        const { createLetterpress } = await import("./letterpressEngine");
        if (disposed) return;
        const made = await createLetterpress({
          host: stage,
          embedded,
          reduced,
          insets,
          text: textRef.current,
          face: faceRef.current,
          onStatus: (next) => {
            if (!disposed) setInfo(next);
          },
          onText: (next) => {
            textRef.current = next;
            if (!disposed) setTitle(next);
          },
        });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "160px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const changeTitle = (value) => {
    const next = Array.from(value).slice(0, 14).join("");
    textRef.current = next;
    setTitle(next);
    engineRef.current?.setText(next, faceRef.current);
  };

  const changeFace = (id) => {
    faceRef.current = id;
    setFace(id);
    engineRef.current?.setText(textRef.current, id);
  };

  const Root = embedded ? "div" : "main";
  const statusLine = info.pressing
    ? `Pressing, ${info.word}`
    : info.word
      ? `No. ${String(info.pulled).padStart(2, "0")}, ${info.word}`
      : `Forme inked ${info.ink}%`;

  return (
    <Root ref={rootRef} className="letterpress-root" data-embedded={embedded ? "" : undefined} data-status={status}>
      <div ref={stageRef} className="letterpress-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL} />
      <div className="letterpress-vignette" aria-hidden="true" />

      {embedded ? null : (
        <header ref={headRef} className="letterpress-head">
          <h1 className="letterpress-title">Letterpress</h1>
          <p className="letterpress-lede">
            Roll ink onto the type, then pull the lever. Every sheet <em>bites a little differently</em>.
          </p>
        </header>
      )}

      {embedded ? null : (
        <div ref={panelRef} className="letterpress-panel">
          <div className="letterpress-tray">
            <label className="letterpress-field">
              <span className="letterpress-field-label">Title</span>
              <input
                className="letterpress-input"
                type="text"
                value={title}
                maxLength={14}
                spellCheck={false}
                autoComplete="off"
                aria-label="Song title to set in wood type"
                onChange={(e) => changeTitle(e.target.value)}
              />
            </label>
            <div className="letterpress-faces" role="radiogroup" aria-label="Wood type">
              {FACES.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={face === f.id}
                  className="letterpress-face"
                  data-face={f.id}
                  onClick={() => changeFace(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <p className="letterpress-status" aria-live="polite">
            <span className="letterpress-status-ink" aria-hidden="true" style={{ "--letterpress-ink": `${Math.min(100, info.ink)}%` }} />
            <span>{status === "failed" ? "This piece needs WebGL." : statusLine}</span>
          </p>
        </div>
      )}
    </Root>
  );
}
