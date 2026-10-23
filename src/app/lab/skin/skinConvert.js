// Real remakes for the playlist: each track's 30-second preview (or a file the
// visitor drops on the player) goes through the chiptune converter, one at a
// time, and the result replaces the track's made-up arrangement.

const keyOf = (t) => `${t.title}|${t.artist}`;

async function previewUrl(track, signal) {
  const q = new URLSearchParams({ artist: track.artist || "", title: track.title });
  const res = await fetch(`/api/spotify/preview?${q}`, { signal });
  if (!res.ok) throw new Error("no preview");
  const { url } = await res.json();
  return { direct: url, proxied: `/api/spotify/preview?${q}&stream=1` };
}

export function createConverter({ onChange }) {
  const jobs = new Map();
  const queue = [];
  const abort = new AbortController();
  let busy = false;
  let lib = null;

  const pump = async () => {
    if (busy || !queue.length || abort.signal.aborted) return;
    busy = true;
    const job = queue.shift();
    job.state = "converting";
    onChange(job);
    try {
      lib ??= await import("@/lib/chiptune");
      const input = job.file ?? (await previewUrl(job, abort.signal));
      const opts = { title: job.title, artist: job.artist, signal: abort.signal, onProgress: (p) => {
        job.progress = p;
        onChange(job);
      } };
      let result;
      if (job.file) result = await lib.convertToChiptune(job.file, opts);
      else {
        // Apple's CDN allows cross-origin reads; the proxy is the fallback.
        result = await lib.convertToChiptune(input.direct, opts).catch((err) => {
          if (abort.signal.aborted) throw err;
          return lib.convertToChiptune(input.proxied, opts);
        });
      }
      job.song = result.song;
      job.midi = result.midi;
      job.state = "ready";
    } catch (err) {
      if (abort.signal.aborted) return;
      job.state = "failed";
      job.error = err;
    }
    busy = false;
    onChange(job);
    pump();
  };

  const enqueue = (job, front) => {
    if (front) queue.unshift(job);
    else queue.push(job);
    pump();
    return job;
  };

  return {
    get(track) {
      return jobs.get(keyOf(track)) ?? null;
    },
    // `front` jumps the queue: the track the visitor is waiting on.
    request(track, front = true) {
      const k = keyOf(track);
      let have = jobs.get(k);
      // A preview that failed (offline, no match) gets another try next time.
      if (have?.state === "failed") {
        jobs.delete(k);
        have = null;
      }
      // Skipping through the list shouldn't leave a backlog of conversions
      // nobody is waiting for: a new front request drops queued previews.
      if (front) {
        for (const j of queue.filter((q) => !q.file && q !== have)) {
          queue.splice(queue.indexOf(j), 1);
          jobs.delete(j.key);
        }
      }
      if (have) {
        if (front && have.state === "queued") {
          queue.splice(queue.indexOf(have), 1);
          queue.unshift(have);
        }
        return have;
      }
      const job = { key: k, title: track.title, artist: track.artist, state: "queued", progress: 0, song: null };
      jobs.set(k, job);
      return enqueue(job, front);
    },
    addFile(file) {
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || "Untitled";
      const job = { key: `${title}|file:${file.size}`, title, artist: "Your file", file, state: "queued", progress: 0, song: null };
      jobs.set(job.key, job);
      return enqueue(job, true);
    },
    destroy() {
      abort.abort();
      queue.length = 0;
    },
  };
}
