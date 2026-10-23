import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./camcorderTakes";

// Starts off; the Sound button turns it on. The bed (zoom motor, tape
// transport, playback hiss) runs while sound is on and follows the camera.
export function createCamSound() {
  const sound = createSound({ level: -8, room: 0.08, on: false });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let bed = null;
  const last = { zoom: -1, tape: -1, hiss: -1 };

  const startBed = () => {
    if (bed) return;
    const zoom = sound.loop(bank.zoom);
    const tape = sound.loop(bank.tape);
    const hiss = sound.loop(bank.hiss);
    if (!zoom || !tape || !hiss) return;
    bed = { zoom, tape, hiss };
  };

  const stopBed = () => {
    if (!bed) return;
    bed.zoom.stop();
    bed.tape.stop();
    bed.hiss.stop();
    bed = null;
    last.zoom = -1;
    last.tape = -1;
    last.hiss = -1;
  };

  const level = (x, top) => (x > 0 ? db(top) * x : 0);

  return {
    async setEnabled(on) {
      const ok = await sound.setEnabled(on);
      if (on) {
        if (!ok) return false;
        startBed();
        return true;
      }
      stopBed();
      return false;
    },
    beep(count) {
      if (!sound.live) return;
      for (let i = 0; i < count; i += 1) sound.play(bank.beep, { gain: -14, at: 0.01 + i * 0.13 });
    },
    clunk() {
      if (!sound.live) return;
      sound.play(bank.clunk, { gain: -7, rate: 0.98 + Math.random() * 0.04 });
    },
    focusTick() {
      if (!sound.live) return;
      sound.play(bank.focus, { gain: -17 + Math.random() * 2, rate: 0.97 + Math.random() * 0.06 });
    },
    update({ zoom, tape, hiss }) {
      if (!sound.live || !bed) return;
      const t = sound.ctx.currentTime;
      const z = Math.min(1, Math.round(zoom * 50) / 50);
      if (z !== last.zoom) {
        bed.zoom.gain.setTargetAtTime(level(z, -12), t, 0.03);
        // Pushed harder, the motor spins faster: buzz and gear whine rise.
        bed.zoom.rate.setTargetAtTime(0.8 + z * 0.45, t, 0.05);
        last.zoom = z;
      }
      const tp = tape ? 1 : 0;
      if (tp !== last.tape) {
        bed.tape.gain.setTargetAtTime(level(tp, -20), t, 0.08);
        // The drum spins up from standstill and coasts down.
        bed.tape.rate.setTargetAtTime(tp ? 1 : 0.85, t, 0.12);
        last.tape = tp;
      }
      const h = Math.round(hiss * 40) / 40;
      if (h !== last.hiss) {
        bed.hiss.gain.setTargetAtTime(level(Math.min(1, h), -16), t, 0.03);
        last.hiss = h;
      }
    },
    destroy() {
      stopBed();
      sound.destroy();
    },
  };
}
