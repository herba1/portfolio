// Renders takes off the main thread. The engine asks by a bank's key and
// name (see registry.js); the take comes back as a transferred buffer.
import { rng, roomImpulseData } from "./synth.js";
import { TAKES } from "./registry.js";

self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (data.room) {
      const channels = roomImpulseData(data.sr);
      self.postMessage({ id, out: channels }, channels.map((c) => c.buffer));
      return;
    }
    const load = TAKES[data.key];
    if (!load) throw new Error(`no takes registered as ${data.key}`);
    const spec = (await load()).takes[data.name];
    const out = spec.render(data.sr, rng(data.seed * 7919 + data.index * 104729), data.index);
    self.postMessage({ id, out }, [out.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error?.message || error) });
  }
};
