"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import InkPanel from "./InkPanel";
import InkSheet from "./InkSheet";
import { inkById, penById } from "./wetInkParams";
import "./wet-ink.css";

const STARTING_PEN = penById("brush");

export default function WetInkExperience() {
  const sheetRef = useRef(null);
  const [penId, setPenId] = useState(STARTING_PEN.id);
  const [inkId, setInkId] = useState("iron-gall");
  const [absorb, setAbsorb] = useState(STARTING_PEN.absorb);
  const [dry, setDry] = useState(STARTING_PEN.dry);

  const pen = penById(penId);
  const ink = inkById(inkId);
  const params = useMemo(() => ({ pen, ink: ink.hex, absorb, dry }), [pen, ink.hex, absorb, dry]);

  const choosePen = useCallback((id) => {
    const next = penById(id);
    setPenId(next.id);
    setAbsorb(next.absorb);
    setDry(next.dry);
  }, []);

  return (
    <main className="wi-root bg-surface text-ink" style={{ "--wi-ink": ink.hex }}>
      <header className="wi-head">
        <h1 className="text-title-sm">Wet ink</h1>
        <p className="text-ui-lg text-ink-secondary">A brush that keeps drawing. Take it whenever you like: pause and the ink pools, flick for a hairline, drag through it while it’s still wet.</p>
      </header>

      <div className="wi-stage">
        <section className="wi-desk" aria-label="Brush loop">
          <InkSheet ref={sheetRef} params={params} />
          <div className="wi-actions">
            <button type="button" className="wi-button wi-button--quiet text-ui-lg" onClick={() => sheetRef.current?.wipe()}>
              Clear
            </button>
            <button type="button" className="wi-button wi-button--quiet text-ui-lg" onClick={() => sheetRef.current?.next()}>
              Next drawing
            </button>
          </div>
        </section>

        <InkPanel penId={penId} onPen={choosePen} inkId={inkId} onInk={setInkId} absorb={absorb} onAbsorb={setAbsorb} dry={dry} onDry={setDry} />
      </div>
    </main>
  );
}
