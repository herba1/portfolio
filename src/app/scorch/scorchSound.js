import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./scorchTakes";

// The burning print: a flame bed whose loudness follows how much of the
// sheet is alight, crackles scheduled as a Poisson stream that thickens with
// the heat, and a flare when a piece catches or breaks away.
const TICK_MS = 60;
const LOOKAHEAD_SECONDS = 0.12;
const QUIET = 0.002;

export function createCrackle() {
  const sound = createSound({ level: -8, room: 0.14 });
  const snapBank = sound.bank(takes.snap.render, takes.snap);
  const flameBank = sound.bank(takes.flame.render, takes.flame);
  const flareBank = sound.bank(takes.flare.render, takes.flare);
  let flame = null;
  let enabled = true;
  let woken = false;
  let level = 0;
  let nextPop = 0;
  let timer = 0;
  let shown = -1;

  function bed() {
    if (!flame) return;
    // The roar saturates where the old hiss did (level 0.225).
    const amount = enabled ? Math.min(1, level / 0.225) : 0;
    if (Math.abs(amount - shown) < 0.005 && (amount > 0 || shown === 0)) return;
    shown = amount;
    const t = sound.ctx.currentTime;
    flame.gain.setTargetAtTime(amount > 0.001 ? db(-10) * Math.sqrt(amount) : 0, t, enabled ? 0.3 : 0.05);
    flame.rate.setTargetAtTime(0.92 + amount * 0.14, t, 0.4);
  }

  function tick() {
    if (!sound.live || !enabled || level < QUIET) return;
    const now = sound.ctx.currentTime;
    if (nextPop < now) nextPop = now;
    const rate = 6 + level * 140;
    const strength = Math.min(1, 0.35 + level * 3);
    while (nextPop < now + LOOKAHEAD_SECONDS) {
      // Mostly small snaps, a few loud ones, as a real burn has.
      const size = Math.random() ** 2.2;
      sound.play(snapBank, {
        gain: -24 + size * 14 + 20 * Math.log10(strength),
        pan: Math.random() * 0.9 - 0.45,
        rate: 0.85 + Math.random() * 0.3,
        at: nextPop - now,
      });
      nextPop += -Math.log(1 - Math.random()) / rate;
    }
  }

  function syncTimer() {
    const wanted = woken && enabled && level >= QUIET;
    if (wanted && !timer) timer = window.setInterval(tick, TICK_MS);
    if (!wanted && timer) {
      window.clearInterval(timer);
      timer = 0;
    }
  }

  function flare(strength) {
    sound.play(flareBank, { gain: -5 + 20 * Math.log10(Math.max(0.1, strength)) + (Math.random() * 2 - 1), rate: 0.95 + Math.random() * 0.1 });
  }

  return {
    wake() {
      if (typeof window === "undefined") return;
      woken = true;
      sound.unlock();
      if (!flame) {
        flame = sound.loop(flameBank);
        bed();
      }
      syncTimer();
    },
    setLevel(next) {
      level = next;
      bed();
      syncTimer();
    },
    setEnabled(next) {
      enabled = next;
      // The client's own switch stops new hits; the flame bed is a live loop,
      // so it fades here.
      sound.setEnabled(next);
      bed();
      syncTimer();
    },
    catchFire(strength = 1) {
      if (!woken || !enabled) return;
      if (sound.live) {
        flare(strength);
        return;
      }
      // The first ignition can arrive in the same gesture that resumed the
      // context: play once it is running.
      sound.setEnabled(true).then((running) => {
        if (running && enabled) flare(strength);
      });
    },
    dispose() {
      if (timer) window.clearInterval(timer);
      timer = 0;
      flame?.stop();
      flame = null;
      sound.destroy();
    },
  };
}
