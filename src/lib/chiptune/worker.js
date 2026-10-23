import { analyze } from "./analyze";

self.onmessage = async ({ data: { id, mono } }) => {
  try {
    const analysis = await analyze(mono, { onProgress: (p) => self.postMessage({ id, progress: p }) });
    self.postMessage({ id, analysis });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
