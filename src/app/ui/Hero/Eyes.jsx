"use client";

import { Component, useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import useMeasure from "react-use-measure";
import { geist } from "@/app/fonts";
import { useLenis } from "@/context/LenisContext";

/* ─────────────────────────────────────────────────────────
 * HERO EYES — Live visitor presence on the hero
 *
 * Each real visitor connected via PartyKit gets a pair
 * of eyes at a random position. They can type short
 * messages that appear as speech bubbles.
 *
 * No fake eyes — only real visitors.
 * ───────────────────────────────────────────────────────── */

const STIMS = [
  "blink", "wink-left", "wink-right", "nose-look",
  "angry", "look-up", "look-right", "double-blink", "wide-eye",
];

// ── Typing Indicator (bouncing dots) ───────────────────

function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.7, y: 4 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { type: "spring", visualDuration: 0.25, bounce: 0.3 },
        y: { type: "spring", visualDuration: 0.2, bounce: 0.2 },
      }}
      style={{
        position: "absolute",
        bottom: "calc(100% + 4px)",
        left: "50%",
        x: "-50%",
        transformOrigin: "center bottom",
        pointerEvents: "none",
      }}
    >
      <div style={{
        display: "flex",
        gap: "3px",
        padding: "5px 8px",
        background: "rgba(0,0,0,0.08)",
        borderRadius: "6px",
        alignItems: "center",
      }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: "4px",
              height: "4px",
              borderRadius: "50%",
              background: "rgba(0,0,0,0.4)",
              animation: `typingDot 1s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
      <div style={{
        position: "absolute",
        bottom: "-4px",
        left: "50%",
        transform: "translateX(-50%)",
        width: 0,
        height: 0,
        borderLeft: "4px solid transparent",
        borderRight: "4px solid transparent",
        borderTop: "5px solid rgba(0,0,0,0.08)",
      }} />
      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-3px); opacity: 1; }
        }
      `}</style>
    </motion.div>
  );
}

// ── Speech Bubble ──────────────────────────────────────

function SpeechBubble({ message }) {
  const [ref, bounds] = useMeasure();
  const [displayedText, setDisplayedText] = useState("");
  const charIndex = useRef(0);

  useEffect(() => {
    if (!message) return;
    charIndex.current = 0;
    setDisplayedText("");

    const startDelay = setTimeout(() => {
      charIndex.current++;
      setDisplayedText(message.slice(0, 1));

      const interval = setInterval(() => {
        charIndex.current++;
        if (charIndex.current > message.length) {
          clearInterval(interval);
          return;
        }
        setDisplayedText(message.slice(0, charIndex.current));
      }, 40 + Math.random() * 30);

      return () => clearInterval(interval);
    }, 150);

    return () => clearTimeout(startDelay);
  }, [message]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5, y: 8 }}
      animate={{
        opacity: 1,
        scale: 1,
        y: 0,
        width: bounds.width > 0 ? bounds.width + 1 : "auto",
      }}
      exit={{ opacity: 0, scale: 0.7, y: 4 }}
      transition={{
        opacity: { duration: 0.15 },
        scale: { type: "spring", visualDuration: 0.25, bounce: 0.3 },
        y: { type: "spring", visualDuration: 0.2, bounce: 0.2 },
        width: { type: "spring", visualDuration: 0.15, bounce: 0.05 },
      }}
      style={{
        position: "absolute",
        bottom: "calc(100% + 4px)",
        left: "50%",
        x: "-50%",
        transformOrigin: "center bottom",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <div
        ref={ref}
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          padding: "3px 7px",
          fontSize: "10px",
          lineHeight: 1.2,
        }}
      >
        {displayedText || "\u00A0"}
      </div>
      <div
        style={{
          whiteSpace: "nowrap",
          padding: "3px 7px",
          fontSize: "10px",
          lineHeight: 1.2,
          background: "rgba(0,0,0,0.08)",
          borderRadius: "6px",
          color: "rgba(0,0,0,0.7)",
          fontFamily: "var(--font-geist-sans, system-ui)",
        }}
      >
        {displayedText || "\u00A0"}
      </div>
      <div style={{
        position: "absolute",
        bottom: "-4px",
        left: "50%",
        transform: "translateX(-50%)",
        width: 0,
        height: 0,
        borderLeft: "4px solid transparent",
        borderRight: "4px solid transparent",
        borderTop: "5px solid rgba(0,0,0,0.08)",
      }} />
    </motion.div>
  );
}

// ── Eye Pair (SVG + animations) ────────────────────────

function EyePair({ style, id = "eyes", index = 0, message = null, typing = false, isSelf = false }) {
  const [stim, setStim] = useState(null);
  const [stimKey, setStimKey] = useState(0);
  const timeoutRef = useRef(null);

  useEffect(() => {
    const scheduleNext = () => {
      const delay = 1500 + Math.random() * 3000;
      timeoutRef.current = setTimeout(() => {
        const pick = STIMS[Math.floor(Math.random() * STIMS.length)];
        setStim(pick);
        setStimKey((k) => k + 1);
        setTimeout(() => setStim(null), 900);
        scheduleNext();
      }, delay);
    };
    const initial = 1000 + Math.random() * 2000;
    timeoutRef.current = setTimeout(scheduleNext, initial);
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div style={{ position: style.position || "absolute", ...style }}>
      <AnimatePresence>
        {message
          ? <SpeechBubble key={`msg-${message}`} message={message} />
          : typing
            ? <TypingIndicator key="typing" />
            : null
        }
      </AnimatePresence>
      {isSelf && (
        <div className="hidden sm:block" style={{
          position: "absolute",
          bottom: "-12px",
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: "8px",
          color: "rgba(0,0,0,0.25)",
          whiteSpace: "nowrap",
          fontFamily: "var(--font-geist-sans, system-ui)",
        }}>
          you
        </div>
      )}
      <svg
        width="52"
        height="26"
        viewBox="0 0 39 19"
        fill="none"
        className={`hero-eyes hero-eyes--${id}`}
        data-stim={stim || undefined}
      >
        <style>{`
          .hero-eyes { pointer-events: none; }

          .hero-eyes--${id} .eye-left {
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center;
            animation:
              eyeEnter${id} 0.5s cubic-bezier(0.16, 1, 0.3, 1) var(--entry-delay, 0.6s) forwards,
              eyeDriftL${id} var(--drift-dur, 8s) ease-in-out var(--drift-delay, 1.2s) infinite;
          }
          .hero-eyes--${id} .eye-right {
            opacity: 0;
            transform-box: fill-box;
            transform-origin: center;
            animation:
              eyeEnter${id} 0.5s cubic-bezier(0.16, 1, 0.3, 1) calc(var(--entry-delay, 0.6s) + 0.1s) forwards,
              eyeDriftR${id} var(--drift-dur, 8s) ease-in-out var(--drift-delay, 1.2s) infinite;
          }

          @keyframes eyeEnter${id} {
            0%   { opacity: 0; transform: scale(0.85) translateY(6px); }
            100% { opacity: 1; transform: scale(1) translateY(0); }
          }

          @keyframes eyeDriftL${id} {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            25%      { transform: translate(-0.5px, 0.3px) rotate(-0.5deg); }
            50%      { transform: translate(0.3px, -0.4px) rotate(0.3deg); }
            75%      { transform: translate(-0.2px, 0.2px) rotate(-0.2deg); }
          }
          @keyframes eyeDriftR${id} {
            0%, 100% { transform: translate(0, 0) rotate(0deg); }
            30%      { transform: translate(0.4px, -0.3px) rotate(0.4deg); }
            55%      { transform: translate(-0.3px, 0.5px) rotate(-0.3deg); }
            80%      { transform: translate(0.2px, -0.1px) rotate(0.2deg); }
          }

          .hero-eyes--${id} .pupil-left,
          .hero-eyes--${id} .pupil-right {
            transform-box: fill-box;
            transform-origin: center;
          }
          .hero-eyes--${id} .pupil-left {
            animation: idlePupilL${id} var(--look-dur, 7s) ease-in-out var(--look-delay, 1.1s) infinite;
          }
          .hero-eyes--${id} .pupil-right {
            animation: idlePupilR${id} var(--look-dur, 7s) ease-in-out var(--look-delay, 1.1s) infinite;
          }

          @keyframes idlePupilL${id} {
            0%, 100% { transform: translate(0, 0); }
            20%      { transform: translate(0.4px, 0.2px); }
            45%      { transform: translate(-0.3px, -0.2px); }
            70%      { transform: translate(0.2px, -0.1px); }
          }
          @keyframes idlePupilR${id} {
            0%, 100% { transform: translate(0, 0); }
            25%      { transform: translate(0.3px, 0.1px); }
            50%      { transform: translate(-0.4px, -0.3px); }
            75%      { transform: translate(0.1px, 0.2px); }
          }

          .hero-eyes--${id} .stim-left,
          .hero-eyes--${id} .stim-right {
            transform-box: fill-box;
            transform-origin: center;
          }

          .hero-eyes--${id}[data-stim="blink"] .stim-left,
          .hero-eyes--${id}[data-stim="blink"] .stim-right {
            animation: stimBlink 0.25s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .hero-eyes--${id}[data-stim="double-blink"] .stim-left,
          .hero-eyes--${id}[data-stim="double-blink"] .stim-right {
            animation: stimDoubleBlink 0.5s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .hero-eyes--${id}[data-stim="wink-left"] .stim-left {
            animation: stimBlink 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .hero-eyes--${id}[data-stim="wink-right"] .stim-right {
            animation: stimBlink 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
          }
          .hero-eyes--${id}[data-stim="nose-look"] .pupil-left {
            animation: stimNoseL 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="nose-look"] .pupil-right {
            animation: stimNoseR 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="angry"] .stim-left,
          .hero-eyes--${id}[data-stim="angry"] .stim-right {
            animation: stimAngryLid 0.8s cubic-bezier(0.22, 1, 0.36, 1);
          }
          .hero-eyes--${id}[data-stim="look-up"] .pupil-left {
            animation: stimLookUpL 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="look-up"] .pupil-right {
            animation: stimLookUpR 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="look-right"] .pupil-left {
            animation: stimLookRightL 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="look-right"] .pupil-right {
            animation: stimLookRightR 0.7s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          }
          .hero-eyes--${id}[data-stim="wide-eye"] .stim-left,
          .hero-eyes--${id}[data-stim="wide-eye"] .stim-right {
            animation: stimWide 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
          }

          @keyframes stimBlink {
            0%   { transform: scaleY(1); }
            35%  { transform: scaleY(0.05); }
            100% { transform: scaleY(1); }
          }
          @keyframes stimDoubleBlink {
            0%   { transform: scaleY(1); }
            18%  { transform: scaleY(0.05); }
            36%  { transform: scaleY(1); }
            54%  { transform: scaleY(0.05); }
            72%  { transform: scaleY(1); }
            100% { transform: scaleY(1); }
          }
          @keyframes stimNoseL {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(2px, 0.5px); }
            65%  { transform: translate(2px, 0.5px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimNoseR {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(-2px, 0.5px); }
            65%  { transform: translate(-2px, 0.5px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimAngryLid {
            0%   { transform: scaleY(1); }
            25%  { transform: scaleY(0.5); }
            65%  { transform: scaleY(0.5); }
            100% { transform: scaleY(1); }
          }
          @keyframes stimLookUpL {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(-0.3px, -1.5px); }
            65%  { transform: translate(-0.3px, -1.5px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimLookUpR {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(0.2px, -1.3px); }
            65%  { transform: translate(0.2px, -1.3px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimLookRightL {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(1.8px, 0.2px); }
            65%  { transform: translate(1.8px, 0.2px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimLookRightR {
            0%   { transform: translate(0, 0); }
            25%  { transform: translate(1.5px, 0.3px); }
            65%  { transform: translate(1.5px, 0.3px); }
            100% { transform: translate(0, 0); }
          }
          @keyframes stimWide {
            0%   { transform: scaleY(1) scaleX(1); }
            30%  { transform: scaleY(1.15) scaleX(1.05); }
            60%  { transform: scaleY(1.15) scaleX(1.05); }
            100% { transform: scaleY(1) scaleX(1); }
          }
        `}</style>

        <g className="eye-left">
          <g className="stim-left" key={`stL-${stimKey}`}>
            <path className="brow-left" d="M2 7C6.51269 5.69715 9.12068 5.63653 14 7" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M8 1C11.7118 1 15 4.63766 15 9.5C15 14.3623 11.7118 18 8 18C4.28815 18 1 14.3623 1 9.5C1 4.63766 4.28815 1 8 1Z" stroke="black" strokeWidth="2" />
            <circle className="pupil-left" cx="8.5" cy="10.5" r="2.5" fill="black" />
          </g>
        </g>
        <g className="eye-right">
          <g className="stim-right" key={`stR-${stimKey}`}>
            <path className="brow-right" d="M25 7C29.5127 5.69715 32.1207 5.63653 37 7" stroke="black" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M31 1C34.7118 1 38 4.63766 38 9.5C38 14.3623 34.7118 18 31 18C27.2882 18 24 14.3623 24 9.5C24 4.63766 27.2882 1 31 1Z" stroke="black" strokeWidth="2" />
            <circle className="pupil-right" cx="31.5" cy="10.5" r="2.5" fill="black" />
          </g>
        </g>
      </svg>
    </div>
  );
}

// ── Error Boundary ─────────────────────────────────────

class LiveEyesBoundary extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? null : this.props.children; }
}

// ── Seeded random for per-visitor consistency ──────────

function seeded(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 1000) / 1000;
}

// ── Message Input ──────────────────────────────────────

function MessageInput({ onSend, onTyping, visitorCount, lenis }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      // Save scroll position, pause Lenis, focus without scroll
      const scrollY = window.scrollY;
      lenis?.stop();
      inputRef.current?.focus({ preventScroll: true });
      // Restore scroll position in case iOS moved it
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollY);
        setTimeout(() => lenis?.start(), 300);
      });
      onTyping?.();
    }
  }, [open, onTyping, lenis]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const msg = text.trim().slice(0, 20);
    if (!msg) return;
    onSend(msg);
    setText("");
    setOpen(false);
  };

  const countLabel = visitorCount <= 1
    ? "just you"
    : `${visitorCount} here`;

  // Hide on mobile — keyboard interactions are problematic
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(window.innerWidth <= 768);
  }, []);

  if (isMobile) return null;

  return (
    <div
      className={`hero-message-input ${geist.className}`}
      style={{
        position: "fixed",
        bottom: "0",
        left: "0",
        right: "0",
        zIndex: 50,
        pointerEvents: "none",
        transition: "opacity 0.4s ease, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
        padding: "2rem 1.5rem 1.25rem",
        display: "flex",
        justifyContent: "center",
        background: `linear-gradient(to top,
          rgb(241 245 249 / 0.97) 0%,
          rgb(241 245 249 / 0.95) 15%,
          rgb(241 245 249 / 0.85) 30%,
          rgb(241 245 249 / 0.65) 45%,
          rgb(241 245 249 / 0.4) 60%,
          rgb(241 245 249 / 0.2) 75%,
          rgb(241 245 249 / 0.08) 88%,
          transparent 100%
        )`,
      }}
    >
      <AnimatePresence mode="wait">
        {!open ? (
          <motion.button
            key="trigger"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: "none",
              border: "none",
              padding: "0",
              fontSize: "12px",
              color: "rgba(0,0,0,0.35)",
              cursor: "pointer",
              fontFamily: "inherit",
              transition: "color 0.15s ease",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              pointerEvents: "auto",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(0,0,0,0.55)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(0,0,0,0.35)")}
          >
            <span>say something</span>
            <span style={{ opacity: 0.6, fontSize: "10px" }}>{countLabel}</span>
          </motion.button>
        ) : (
          <motion.form
            key="input"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ type: "spring", visualDuration: 0.25, bounce: 0.2 }}
            style={{ display: "flex", gap: "6px", alignItems: "center", pointerEvents: "auto" }}
          >
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 20))}
              onBlur={() => { if (!text.trim()) setOpen(false); }}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              placeholder="say something..."
              maxLength={20}
              style={{
                background: "rgba(0,0,0,0.04)",
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: "10px",
                padding: "8px 12px",
                fontSize: "16px",
                color: "rgba(0,0,0,0.6)",
                outline: "none",
                width: "200px",
                fontFamily: "inherit",
              }}
            />
            <button
              type="submit"
              style={{
                background: text.trim() ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.03)",
                border: "none",
                borderRadius: "8px",
                padding: "8px 12px",
                fontSize: "13px",
                color: text.trim() ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.2)",
                cursor: text.trim() ? "pointer" : "default",
                fontFamily: "inherit",
                transition: "background 0.15s ease, color 0.15s ease",
                pointerEvents: "auto",
                whiteSpace: "nowrap",
              }}
            >
              send
            </button>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Live Eyes (PartyKit-connected) ─────────────────────

function LiveEyesInner({ usePresence }) {
  const { visitors, selfId, sendMessage, sendTyping } = usePresence("hero");
  const { lenis } = useLenis();
  return (
    <>
      <AnimatePresence>
        {visitors.map((v, i) => {
          const r = seeded(v.id);
          const rotation = (v.rotation ?? (r * 10 - 5)).toFixed(1);
          const scale = (0.85 + r * 0.3).toFixed(2);
          const lookDur = (6 + r * 4).toFixed(1);
          const driftDur = (8 + r * 6).toFixed(1);
          const isSelf = v.id === selfId;

          return (
            <motion.div
              key={v.id}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: isSelf ? 0.4 : 0.3, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              style={{
                position: "absolute",
                top: `${v.y * 100}%`,
                left: `${v.x * 100}%`,
                transform: `rotate(${rotation}deg) scale(${scale})`,
              }}
            >
              <EyePair
                id={`v-${v.id.slice(0, 8)}`}
                index={i}
                message={v.message}
                typing={v.typing}
                isSelf={isSelf}
                style={{
                  position: "relative",
                  "--entry-delay": "0.05s",
                  "--look-dur": `${lookDur}s`,
                  "--look-delay": `${(r * 2).toFixed(1)}s`,
                  "--drift-dur": `${driftDur}s`,
                  "--drift-delay": `${(r * 3).toFixed(1)}s`,
                }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
      {selfId && <MessageInput onSend={sendMessage} onTyping={sendTyping} visitorCount={visitors.length} lenis={lenis} />}
    </>
  );
}

// ── Main Export ─────────────────────────────────────────

export default function HeroEyes() {
  const [presenceModule, setPresenceModule] = useState(null);
  useEffect(() => {
    import("./usePresence")
      .then((mod) => setPresenceModule(mod))
      .catch(() => {});
  }, []);

  return (
    <div className="hero-eyes-container" style={{
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      pointerEvents: "none",
      contain: "style",
    }}>
      {presenceModule && (
        <LiveEyesBoundary>
          <LiveEyesInner usePresence={presenceModule.default} />
        </LiveEyesBoundary>
      )}
    </div>
  );
}
