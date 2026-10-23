import { analyze } from "./analyze";

const running = new Map();

self.onmessage = async ({ data: { id, mono, cancel } }) => {
  if (cancel) {
    running.get(cancel)?.abort();
    return;
  }
  const ctl = new AbortController();
  running.set(id, ctl);
  try {
    const analysis = await analyze(mono, { signal: ctl.signal, onProgress: (p) => self.postMessage({ id, progress: p }) });
    if (!ctl.signal.aborted) self.postMessage({ id, analysis });
  } catch (err) {
    if (!ctl.signal.aborted) self.postMessage({ id, error: String(err?.message || err) });
  } finally {
    running.delete(id);
  }
};
