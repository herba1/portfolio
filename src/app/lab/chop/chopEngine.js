import { PADS } from "./chopSlicer";

const TICK_MS = 25;
const HORIZON_SECONDS = 0.12;
const ARM_SECONDS = 0.22;
const ARM_HORIZON_SECONDS = 0.03;
const HIT_RISE = 0.004;
const HIT_FALL = 0.012;
const SPLICE_SECONDS = 0.006;
const STOP_FALL = 0.012;
const SETTLE_SECONDS = 0.001;
const UNSTARTED_MARGIN = 0.008;
const SPLICE_TOLERANCE = 0.04;
const MIN_SLICE = 0.03;
const MAX_VOICES = 12;
const START_LEAD = 0.03;
const SUSPEND_DELAY_MS = 60;
const CURVE_POINTS = 33;

function equalPower(rising) {
  const curve = new Float32Array(CURVE_POINTS);
  for (let point = 0; point < CURVE_POINTS; point += 1) {
    const angle = (point / (CURVE_POINTS - 1)) * Math.PI * 0.5;
    curve[point] = rising ? Math.sin(angle) : Math.cos(angle);
  }
  return curve;
}

const RISE = equalPower(true);
const FALL = equalPower(false);

function identity() {
  return Uint8Array.from({ length: PADS }, (_, index) => index);
}

function stopSource(source, time) {
  try {
    source.stop(time);
    return true;
  } catch {
    return false;
  }
}

export function createChopEngine({ onVoice, onRecord, onTransport }) {
  let context = null;
  let output = null;
  let track = null;
  let timer = 0;
  let suspendTimer = 0;
  let pendingPlay = false;
  const pattern = identity();
  const settings = { quantise: false, choke: true, swing: 0 };
  const voices = [];
  const holds = new Map();
  const waiting = new Map();
  const transport = { playing: false, origin: 0, count: 0, nextTime: 0, voice: null, claim: null, scheduled: new Map() };

  function running() {
    return Boolean(context) && context.state === "running";
  }

  function flush() {
    if (!running() || !track) return;
    if (pendingPlay) {
      pendingPlay = false;
      startTransport();
    }
    if (!waiting.size) return;
    const queued = Array.from(waiting.entries());
    waiting.clear();
    for (const [key, hit] of queued) strike(key, hit.position, hit.reverse, !hit.released);
  }

  function ensure() {
    if (typeof window === "undefined") return null;
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass({ latencyHint: "interactive" });
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      output = context.createGain();
      output.gain.value = 0.9;
      output.connect(limiter).connect(context.destination);
      context.addEventListener("statechange", flush);
      if ("audioSession" in navigator) navigator.audioSession.type = "playback";
    }
    if (suspendTimer) {
      clearTimeout(suspendTimer);
      suspendTimer = 0;
    }
    if (context.state !== "running" && context.state !== "closed") context.resume().then(flush, () => null);
    return context;
  }

  function clock() {
    if (!context) return 0;
    return context.currentTime - (context.outputLatency || 0);
  }

  function sliceLength(slice) {
    return Math.max(MIN_SLICE, track.bounds[slice + 1] - track.bounds[slice]);
  }

  function retire(voice) {
    voice.dead = true;
    voice.gain.disconnect();
    const index = voices.indexOf(voice);
    if (index >= 0) voices.splice(index, 1);
  }

  function openVoice(slice, when, reverse, rise, limit) {
    const buffer = reverse ? track.reversed : track.forward;
    const offset = Math.max(0, reverse ? buffer.duration - track.bounds[slice + 1] : track.bounds[slice]);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.setValueCurveAtTime(RISE, when, rise);
    source.connect(gain).connect(output);
    source.start(when, offset, Math.min(Math.max(MIN_SLICE, buffer.duration - offset), limit));
    const voice = {
      source,
      gain,
      slice,
      lastSlice: slice,
      reverse,
      when,
      riseEnd: when + rise,
      fallAt: Infinity,
      end: Infinity,
      segments: [],
      loose: false,
      dead: false,
    };
    source.onended = () => retire(voice);
    voices.push(voice);
    return voice;
  }

  function mark(voice, position, slice, when, natural, retrigger) {
    const segment = { voice, position, slice, when, natural, end: when + natural, retrigger, cancelled: false };
    voice.segments.push(segment);
    onVoice?.(segment);
    return segment;
  }

  function fall(voice, at, length) {
    const level = voice.gain.gain;
    level.cancelScheduledValues(at);
    level.setValueCurveAtTime(FALL, at, length);
    voice.fallAt = at;
    voice.end = at + length;
    stopSource(voice.source, voice.end + SETTLE_SECONDS);
    for (const segment of voice.segments) {
      if (segment.when >= at) segment.cancelled = true;
      else if (segment.end > at) segment.end = at;
    }
  }

  function drop(voice) {
    voice.fallAt = voice.when;
    voice.end = voice.when;
    for (const segment of voice.segments) segment.cancelled = true;
    stopSource(voice.source, 0);
    retire(voice);
  }

  function cut(voice, time, length = SPLICE_SECONDS) {
    if (!voice || voice.dead) return;
    const now = context.currentTime;
    if (time <= voice.when && voice.when > now + UNSTARTED_MARGIN) {
      drop(voice);
      return;
    }
    const at = Math.max(time, now, voice.riseEnd + SETTLE_SECONDS);
    if (at >= voice.fallAt) return;
    fall(voice, at, length);
  }

  function choke(voice) {
    let firstAfter = Infinity;
    for (const other of voices.slice()) {
      if (other === voice || other.dead || other.end <= voice.when) continue;
      if (other.when <= voice.when) cut(other, voice.when);
      else if (other.when < firstAfter) firstAfter = other.when;
    }
    if (firstAfter < voice.end) cut(voice, firstAfter);
  }

  function settle(voice) {
    if (settings.choke) choke(voice);
    else if (voices.length > MAX_VOICES) cut(voices[0], voice.when, HIT_FALL);
  }

  function playHit(position, slice, when, { reverse = false, length = Infinity, retrigger = false, open = false } = {}) {
    const natural = Math.max(MIN_SLICE, Math.min(sliceLength(slice), length));
    const voice = openVoice(slice, when, reverse, HIT_RISE, open ? Infinity : natural + SETTLE_SECONDS);
    if (open) voice.loose = true;
    else fall(voice, when + natural - HIT_FALL, HIT_FALL);
    mark(voice, position, slice, when, natural, retrigger);
    settle(voice);
    return voice;
  }

  function gridTime(anchor, index, sixteenth) {
    return anchor + index * sixteenth + (index % 2 === 1 ? settings.swing * 0.5 * sixteenth : 0);
  }

  function clockAnchor() {
    if (transport.playing) return transport.origin;
    for (const hold of holds.values()) return hold.anchor;
    return null;
  }

  function recordAt(time, slice, from, rounding) {
    if (!transport.playing || !track) return -1;
    const exact = (time - transport.origin) / track.stepSeconds;
    const lower = Math.floor(exact + 1e-6);
    const absolute = rounding === "round" ? Math.round(exact) : lower;
    if (absolute < 0) return -1;
    if (absolute > lower) {
      const scheduled = transport.scheduled.get(absolute);
      if (scheduled) cut(scheduled.voice, Math.max(context.currentTime, scheduled.when));
      else transport.claim = { absolute, adopted: false };
    }
    const step = absolute % PADS;
    if (pattern[step] !== slice) {
      pattern[step] = slice;
      onRecord?.(step, slice, from);
    }
    return absolute;
  }

  function extendable(voice, slice, time) {
    if (voice.dead || voice.reverse || voice.fallAt !== Infinity || slice !== voice.lastSlice + 1) return false;
    if (!voice.loose) return true;
    return Math.abs(voice.when + track.bounds[slice] - track.bounds[voice.slice] - time) < SPLICE_TOLERANCE;
  }

  function scheduleStep() {
    const absolute = transport.count;
    const time = transport.nextTime;
    transport.count += 1;
    transport.nextTime = transport.origin + transport.count * track.stepSeconds;
    for (const key of transport.scheduled.keys()) if (key < absolute - 1) transport.scheduled.delete(key);
    const claim = transport.claim;
    if (claim && claim.absolute <= absolute) {
      transport.claim = null;
      if (claim.absolute === absolute) {
        if (!claim.adopted) {
          cut(transport.voice, time);
          transport.voice = null;
        }
        return;
      }
    }
    const step = absolute % PADS;
    const slice = pattern[step];
    const current = transport.voice;
    if (current && extendable(current, slice, time)) {
      current.lastSlice = slice;
      const audioTime = current.when + track.bounds[slice] - track.bounds[current.slice];
      transport.scheduled.set(absolute, mark(current, step, slice, audioTime, sliceLength(slice), false));
      return;
    }
    cut(current, time);
    const voice = openVoice(slice, time, false, SPLICE_SECONDS, Infinity);
    transport.voice = voice;
    transport.scheduled.set(absolute, mark(voice, step, slice, time, sliceLength(slice), false));
    settle(voice);
  }

  function tick() {
    if (!context || !track) return;
    const now = context.currentTime;
    const horizon = now + HORIZON_SECONDS;
    if (transport.playing) {
      while (transport.nextTime < horizon) scheduleStep();
    }
    for (const hold of holds.values()) {
      if (now < hold.armAt) continue;
      while (hold.nextTime < now) {
        hold.index += 1;
        hold.nextTime = gridTime(hold.anchor, hold.index, track.sixteenth);
      }
      const reach = hold.booked ? horizon : now + ARM_HORIZON_SECONDS;
      while (hold.nextTime < reach) {
        const when = hold.nextTime;
        hold.last = playHit(hold.position, hold.slice, when, { reverse: hold.reverse, length: track.sixteenth, retrigger: true });
        hold.booked = true;
        recordAt(when, hold.slice, hold.position, "floor");
        hold.index += 1;
        hold.nextTime = gridTime(hold.anchor, hold.index, track.sixteenth);
      }
    }
  }

  function syncTimer() {
    const needed = Boolean(track) && (transport.playing || holds.size > 0);
    if (needed && !timer) timer = setInterval(tick, TICK_MS);
    if (!needed && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  function strike(key, position, reverse, held) {
    if (!track || !running()) return;
    const slice = pattern[position];
    const now = context.currentTime;
    const anchor = clockAnchor();
    let when = now;
    if (settings.quantise && anchor !== null) {
      const index = Math.ceil((now - anchor) / track.sixteenth - 1e-6);
      when = Math.max(now, gridTime(anchor, index, track.sixteenth));
    }
    const absolute = recordAt(when, slice, position, "round");
    const claimed = transport.claim !== null && transport.claim.absolute === absolute;
    const open = absolute >= 0 && settings.choke && !reverse && (claimed || absolute === transport.count - 1);
    const voice = playHit(position, slice, when, { reverse, open });
    if (open) {
      if (claimed) transport.claim.adopted = true;
      transport.voice = voice;
    }
    if (held) {
      const holdAnchor = anchor ?? when;
      const armAt = when + ARM_SECONDS;
      const index = Math.ceil((armAt - holdAnchor) / track.sixteenth - 1e-6);
      holds.set(key, {
        position,
        slice,
        reverse,
        anchor: holdAnchor,
        armAt,
        index,
        nextTime: gridTime(holdAnchor, index, track.sixteenth),
        booked: false,
        last: null,
      });
    }
    syncTimer();
  }

  function press(key, position, reverse) {
    const audio = ensure();
    if (!audio || !track) return;
    if (audio.state !== "running") {
      waiting.set(key, { position, reverse, released: false });
      return;
    }
    strike(key, position, reverse, true);
  }

  function release(key) {
    const queued = waiting.get(key);
    if (queued) queued.released = true;
    const hold = holds.get(key);
    if (!hold) return;
    holds.delete(key);
    if (hold.last && context && hold.last.when > context.currentTime) cut(hold.last, context.currentTime);
    syncTimer();
  }

  function releaseAll() {
    holds.clear();
    waiting.forEach((hit) => {
      hit.released = true;
    });
    syncTimer();
  }

  function silence() {
    if (!context) return;
    const now = context.currentTime;
    for (const voice of voices.slice()) cut(voice, now, STOP_FALL);
  }

  function startTransport() {
    transport.playing = true;
    transport.origin = context.currentTime + START_LEAD;
    transport.count = 0;
    transport.nextTime = transport.origin;
    transport.voice = null;
    transport.claim = null;
    transport.scheduled.clear();
    syncTimer();
    tick();
  }

  function play() {
    const audio = ensure();
    if (!audio || !track) return false;
    if (audio.state === "running") startTransport();
    else pendingPlay = true;
    onTransport?.(true);
    return true;
  }

  function stop() {
    const wasPending = pendingPlay;
    pendingPlay = false;
    if (!transport.playing) {
      if (wasPending) onTransport?.(false);
      return;
    }
    transport.playing = false;
    if (context) {
      const now = context.currentTime;
      for (const segment of transport.scheduled.values()) cut(segment.voice, now, STOP_FALL);
      cut(transport.voice, now, STOP_FALL);
    }
    transport.voice = null;
    transport.claim = null;
    transport.scheduled.clear();
    syncTimer();
    onTransport?.(false);
  }

  function setTrack(next) {
    stop();
    releaseAll();
    silence();
    waiting.clear();
    track = next;
    pattern.set(identity());
  }

  function resetPattern() {
    pattern.set(identity());
  }

  function suspend() {
    stop();
    releaseAll();
    silence();
    waiting.clear();
    if (!context || context.state !== "running" || suspendTimer) return;
    suspendTimer = setTimeout(() => {
      suspendTimer = 0;
      if (context && context.state === "running") context.suspend().catch(() => null);
    }, SUSPEND_DELAY_MS);
  }

  function destroy() {
    stop();
    releaseAll();
    silence();
    waiting.clear();
    if (timer) clearInterval(timer);
    if (suspendTimer) clearTimeout(suspendTimer);
    timer = 0;
    suspendTimer = 0;
    if (context) {
      context.removeEventListener("statechange", flush);
      context.close().catch(() => null);
    }
    context = null;
  }

  return {
    pattern,
    settings,
    ensure,
    clock,
    press,
    release,
    releaseAll,
    play,
    stop,
    setTrack,
    resetPattern,
    suspend,
    destroy,
    get playing() {
      return transport.playing || pendingPlay;
    },
    get ready() {
      return Boolean(track);
    },
  };
}
