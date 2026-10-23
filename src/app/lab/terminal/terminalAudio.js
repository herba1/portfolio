import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./terminalTakes";

// Starts off; the Sound button turns it on (inside the click, so the shared
// context can start).
export function createTerminalSound() {
  const sound = createSound({ level: -8, room: 0.1, on: false });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastKey = 0;
  let lastTick = 0;
  let hum = null;
  let raster = null;

  const startHum = () => {
    if (hum) return;
    hum = sound.loop(bank.hum);
    if (!hum) return;
    const t = sound.ctx.currentTime;
    hum.gain.setValueAtTime(0, t);
    hum.gain.linearRampToValueAtTime(db(-30), t + 0.6);
  };

  const stopHum = () => {
    hum?.stop();
    hum = null;
  };

  const stopRaster = () => {
    raster?.stop();
    raster = null;
  };

  return {
    async setEnabled(on) {
      const ok = await sound.setEnabled(on);
      if (on) {
        if (!ok) return false;
        startHum();
        sound.play(bank.power, { gain: -6 });
        return true;
      }
      stopHum();
      stopRaster();
      return false;
    },
    // One printed character. `soft` is the fast or dumped text: lighter keys.
    key(soft = false) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastKey < 30) return;
      lastKey = now;
      sound.play(bank.key, {
        gain: (soft ? -16 : -11) + Math.random() * 2 - 1,
        pan: (Math.random() - 0.5) * 0.4,
        rate: 0.97 + Math.random() * 0.06,
      });
    },
    tick() {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastTick < 40) return;
      lastTick = now;
      sound.play(bank.tick, { gain: -13 + Math.random() * 2, rate: 0.97 + Math.random() * 0.06 });
    },
    clunk() {
      if (!sound.live) return;
      sound.play(bank.clunk, { gain: -6, rate: 0.98 + Math.random() * 0.04 });
    },
    raster(on) {
      if (!sound.live) {
        stopRaster();
        return;
      }
      if (on && !raster) {
        raster = sound.loop(bank.raster);
        if (!raster) return;
        const t = sound.ctx.currentTime;
        raster.gain.setValueAtTime(0, t);
        raster.gain.linearRampToValueAtTime(db(-20), t + 0.06);
        // The beam climbs the picture: the line buzz rises with it.
        raster.rate.setValueAtTime(0.8, t);
        raster.rate.exponentialRampToValueAtTime(1.6, t + 1.3);
      } else if (!on && raster) {
        stopRaster();
      }
    },
    destroy() {
      stopHum();
      stopRaster();
      sound.destroy();
    },
  };
}
