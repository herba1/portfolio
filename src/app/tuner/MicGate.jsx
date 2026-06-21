"use client";

// Idle / permission state: a single solid-ink prompt that turns the mic on.
// Sits in the note slot; the live note replaces it once listening.

export default function MicGate({ status, onEnable }) {
  const denied = status === "denied" || status === "error";
  const requesting = status === "requesting";

  const label = denied
    ? "Mic blocked — tap to retry"
    : requesting
      ? "Listening…"
      : "Tap to listen";

  return (
    <button
      type="button"
      className="tuner__gate"
      onClick={onEnable}
      disabled={requesting}
      aria-label={denied ? "Microphone blocked — tap to retry" : "Enable microphone"}
    >
      {label}
      {!requesting && !denied ? " →" : ""}
    </button>
  );
}
