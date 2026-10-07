"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MorphText from "@/app/ui/MorphText";
import SlotNumber from "@/app/ui/SlotNumber";

import InkPanel from "./InkPanel";
import SignatureField from "./SignatureField";
import { inkById, penById } from "./wetInkParams";
import "./wet-ink.css";

const BOOKING_ROWS = [
  { label: "Date", value: "Thu 15 Oct 2026" },
  { label: "Time", value: "14:00–17:00" },
  { label: "Duration", value: "3 hours" },
  { label: "Rate", value: "£140 per hour" },
];

const BOOK_LABELS = { intro: "Sign and book", ready: "Sign and book", booking: "Blotting", booked: "Booked" };

const pad2 = (n) => String(n).padStart(2, "0");

function SignedStamp({ time }) {
  const slotRef = useRef(null);
  useEffect(() => {
    const id = window.setTimeout(() => slotRef.current?.setValue(time), 90);
    return () => window.clearTimeout(id);
  }, [time]);
  return (
    <span className="wi-status__item text-ui-lg" key="signed">
      <span className="text-ink-secondary">Signed</span>{" "}
      <SlotNumber ref={slotRef} className="tabular-nums" value="00:00:00" duration={720} stagger={40} direction="up" label={time} />
    </span>
  );
}

export default function WetInkExperience() {
  const fieldRef = useRef(null);
  const [penId, setPenId] = useState("fountain");
  const [inkId, setInkId] = useState("iron-gall");
  const [absorb, setAbsorb] = useState(1);
  const [dry, setDry] = useState(1);
  const [phase, setPhase] = useState("intro");
  const [signed, setSigned] = useState(false);
  const [signedAt, setSignedAt] = useState("");

  const pen = penById(penId);
  const ink = inkById(inkId);
  const params = useMemo(() => ({ pen, ink: ink.hex, absorb, dry }), [pen, ink.hex, absorb, dry]);

  const choosePen = useCallback((id) => {
    const next = penById(id);
    setPenId(next.id);
    setAbsorb(next.absorb);
    setDry(next.dry);
  }, []);

  const onSigned = useCallback((value) => setSigned(value), []);
  const onIntroDone = useCallback(() => setPhase((current) => (current === "intro" ? "ready" : current)), []);

  const book = () => {
    if (phase !== "ready" || !signed) return;
    setPhase("booking");
    fieldRef.current?.blot(() => {
      const now = new Date();
      setSignedAt(`${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`);
      setPhase("booked");
    });
  };

  const clear = () => {
    if (phase === "booked") {
      fieldRef.current?.reset();
      setSignedAt("");
      setPhase("ready");
      return;
    }
    fieldRef.current?.clear();
  };

  const locked = phase === "booking" || phase === "booked";
  const canBook = phase === "ready" && signed;
  const showHint = !locked && !signed && phase !== "intro";

  return (
    <main className="wi-root bg-surface text-ink" style={{ "--wi-ink": ink.hex }}>
      <header className="wi-head">
        <h1 className="text-title-sm">Wet ink</h1>
        <p className="text-ui-lg text-ink-secondary">Pause and the ink pools, flick for a hairline, drag through it while it’s still wet.</p>
      </header>

      <div className="wi-stage">
        <article className="wi-card" aria-label="Session booking">
          <div className="wi-card__head">
            <div className="wi-card__titles">
              <h2 className="text-heading">Session booking</h2>
              <p className="text-ui-lg text-ink-secondary">Studio Two · Mix room</p>
            </div>
            <span className="wi-card__ref text-ui tabular-nums">No. 2481</span>
          </div>

          <dl className="wi-rows">
            {BOOKING_ROWS.map((row, index) => (
              <div className="wi-row" key={row.label} style={{ "--wi-i": index }}>
                <dt className="text-ui-lg text-ink-secondary">{row.label}</dt>
                <dd className="text-ui-lg tabular-nums">{row.value}</dd>
              </div>
            ))}
            <div className="wi-row wi-row--total" style={{ "--wi-i": BOOKING_ROWS.length }}>
              <dt className="text-heading-sm">Total</dt>
              <dd className="text-heading-sm tabular-nums">£420.00</dd>
            </div>
          </dl>

          <div className="wi-sign">
            <div className="wi-sign__label">
              <span className="text-ui-lg text-ink-secondary">Signature</span>
            </div>
            <SignatureField ref={fieldRef} params={params} locked={locked} onSigned={onSigned} onIntroDone={onIntroDone} />
          </div>

          <div className="wi-actions">
            <button type="button" className="wi-button wi-button--quiet text-ui-lg" onClick={clear} disabled={phase === "booking"}>
              <MorphText text={phase === "booked" ? "New booking" : "Clear"} />
            </button>
            <div className="wi-actions__end">
              <div className="wi-status" aria-live="polite">
                {phase === "booked" && signedAt ? <SignedStamp time={signedAt} /> : null}
                {showHint ? (
                  <span className="wi-status__item text-ui-lg text-ink-secondary" key="hint">
                    Sign above
                  </span>
                ) : null}
              </div>
              <button type="button" className="wi-button wi-button--book text-ui-lg" data-phase={phase} disabled={!canBook} onClick={book}>
                <MorphText text={BOOK_LABELS[phase] ?? BOOK_LABELS.ready} />
              </button>
            </div>
          </div>
        </article>

        <InkPanel penId={penId} onPen={choosePen} inkId={inkId} onInk={setInkId} absorb={absorb} onAbsorb={setAbsorb} dry={dry} onDry={setDry} />
      </div>
    </main>
  );
}
