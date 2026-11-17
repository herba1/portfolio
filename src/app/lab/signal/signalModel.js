// The tape and the receiver, line by line, on the CPU.
//
// Everything here is per scan line: where the playback head sits across the
// tracks, how much RF it gets from its own track and from the neighbours, the
// tape's timebase error, whether the TV's sync separator finds a pulse, the
// TV's horizontal flywheel PLL, its vertical oscillator, the VCR's colour-under
// AFC and the TV's burst-locked colour oscillator. The GPU chain only reads the
// numbers this writes; no artefact is painted on.

export const FS = 14.31818; // MHz, 4 x subcarrier
export const LINE = 910; // samples per line at 4fsc
export const FIELD_LINES = 263; // rows per field stream (262.5, rounded)
export const ACTIVE_X = 135; // first active sample after the sync edge
export const ACTIVE_W = 754;
export const FIRST_ACTIVE = 21; // first active line of a field
export const ACTIVE_LINES = 240;
export const SWITCH_LINE = 256; // head switch, ~6.5 lines before vsync
export const PARAM_COLS = 6;
// the camcorder's AFM ("hi-fi") audio carriers, MHz: recorded deep in the
// oxide by their own heads, under the video tracks
export const AFM_L = 1.3;
export const AFM_R = 1.7;

const TAU = Math.PI * 2;
const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
const wrapLine = (s) => s - LINE * Math.floor((s + LINE / 2) / LINE);

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Head is a little wider than the track (SP): 1.15 pitches.
const HEAD_HALF = 0.575;
const overlap = (off, centre) => Math.max(0, Math.min(off + HEAD_HALF, centre + 0.5) - Math.max(off - HEAD_HALF, centre - 0.5));

export function createModel(seed = 7) {
  const rnd = mulberry(seed);
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd());
  };

  const params = new Float32Array(PARAM_COLS * 4 * FIELD_LINES * 2);
  const s = {
    frame: 0,
    // tape transport
    tension: 0, // OU part of the tension error
    // TV horizontal flywheel PLL (samples)
    P: 0,
    F: 0,
    // TV vertical
    roll: 0,
    // VCR colour-under AFC / APC
    vRate: 0,
    vPhase: 0,
    afcLocked: 1,
    vcoSign: 1,
    // TV colour
    tvPhase: 0,
    burstAvg: 1,
    killer: 1,
    // persistent tape damage (field line of each longitudinal scratch)
    scratches: [],
    scratchSeedWear: -1,
    // AFM audio carrier phases (cycles), running on through the whole tape
    afmL: 0,
    afmR: 0.37,
  };

  // The AFM carriers are frequency-modulated by the park's sound: wind in
  // the mic and a low rumble, a few kHz of deviation. Over a line that is a
  // fraction of a cycle, so the line-to-line phase step of each carrier
  // wanders slowly down the field.
  const afmDev = (t) => [
    9000 * Math.sin(TAU * 41 * t) + 5000 * Math.sin(TAU * 97 * t + 1.3) + 2500 * Math.sin(TAU * 233 * t + 2.1),
    8000 * Math.sin(TAU * 53 * t + 0.7) + 5500 * Math.sin(TAU * 89 * t + 2.4) + 2000 * Math.sin(TAU * 211 * t + 0.4),
  ];

  // A longitudinal scratch crosses every track at the same place along it,
  // so it lands on the same field line every field.
  const setScratches = (wear) => {
    const tier = Math.floor(wear * 6);
    if (tier === s.scratchSeedWear) return;
    s.scratchSeedWear = tier;
    const r = mulberry(1234);
    s.scratches = [];
    const n = Math.max(0, tier - 1);
    for (let i = 0; i < n; i++) s.scratches.push({ line: 30 + Math.floor(r() * 220), x: 140 + r() * 600, len: 20 + r() * 160, p: 0.5 + r() * 0.45 });
  };

  // One frame = two fields. `track` is the servo's actual tracking offset in
  // track pitches (0 = centred on the recorded tracks), `wear` 0..1.
  function step(t, track, wear, trackVel = 0) {
    setScratches(wear);
    const g = 1 + 4 * Math.pow(wear, 1.2); // generations
    const sg = Math.sqrt(g);
    const slope = 0.62 + 0.5 * wear; // track-angle mismatch over a field (pitches)
    const jitter = 0.22 * sg;
    // head-amp and tape noise. A good tape in track is nearly clean: the
    // noise only shows where the carrier itself has sunk (mistracking, wear,
    // or a carrier deviated past the top of the band).
    const sigma = 0.0026 * Math.pow(g, 1.3);
    const kappa = 7; // samples of skew per unit tension error per line
    // Turning the tracking knob is the capstan slipping phase: a momentary
    // tape-speed change, which shifts the line rate (writing speed 5.8 m/s
    // against 33 mm/s of tape: 1 pitch/s is ~0.08 samples a line).
    const speedErr = 0.11 * trackVel;
    const dropRate = 0.15 + 9 * wear * wear; // per field
    const out = params;

    for (let field = 0; field < 2; field++) {
      const tf = t + field / 59.94;
      // tension: reel eccentricity, capstan, and a slow random part
      s.tension += (-s.tension * 0.12 + gauss() * 0.0009 * (1 + 2 * wear));
      const tensionAt = (l) => {
        const tl = tf + l / 15734;
        return (0.0035 * Math.sin(TAU * 0.83 * tl) + 0.0016 * Math.sin(TAU * 6.1 * tl + 1.3) + s.tension) * (1 + 1.5 * wear);
      };
      const head = (s.frame * 2 + field) & 1;
      const headOffset = head ? 1.6 : -1.6; // two heads, mounted a hair apart
      let e = headOffset;
      const lateral = (l) => track + slope * ((l + 0.5) / 262.5 - 0.5) + tensionAt(l) * 6;
      const dFarBase = 6.5 + 2.5 * Math.sin(tf * 0.7);

      // dropouts for this field
      const drops = new Map();
      const addDrop = (l, x, len, depth) => {
        const list = drops.get(l) || [];
        if (list.length < 2) list.push([x, len, depth]);
        drops.set(l, list);
      };
      let nd = 0;
      let acc = -Math.log(1 - rnd());
      while (acc < dropRate && nd < 40) {
        const l = Math.floor(rnd() * 263);
        const len = 6 + Math.pow(rnd(), 2.2) * (60 + 380 * wear);
        addDrop(l, 100 + rnd() * 780, len, rnd() < 0.7 ? 0.02 : 0.25);
        // oxide flakes are not points: a run of lines often goes together
        if (rnd() < 0.35) addDrop(l + 2, 100 + rnd() * 780, len * 0.6, 0.06);
        acc += -Math.log(1 - rnd());
        nd++;
      }
      for (const sc of s.scratches) if (rnd() < sc.p) addDrop(sc.line, sc.x + gauss() * 6, sc.len * (0.6 + 0.6 * rnd()), 0.03);

      // the next track's start, used after the head switch
      const nextHeadOffset = head ? -1.6 : 1.6;
      // the new head comes in with its own timing, and the tape has wandered
      // between the two tracks' starts: the jump grows as the tape stretches
      const nextStart = nextHeadOffset + gauss() * 0.8 * sg + 4 * wear * (head ? 1 : -1);
      const switchX = 360 + gauss() * 8;
      let switchJump = 0;

      for (let l = 0; l < FIELD_LINES; l++) {
        const row = field * FIELD_LINES + l;
        const after = l >= SWITCH_LINE; // reading the next track already
        const T = tensionAt(l);
        e += kappa * T + speedErr + gauss() * jitter;
        const eNew = nextStart + (l - 262.5) * kappa * T + gauss() * jitter;
        if (l === SWITCH_LINE) switchJump = eNew - e;
        const eLine = after && l !== SWITCH_LINE ? eNew : e;
        const off = after ? lateral(l - 262.5) : lateral(l);

        const A = overlap(off, 0);
        const adj = overlap(off, 1) + overlap(off, -1);
        const far = overlap(off, 2) + overlap(off, -2);
        // the neighbour's opposite azimuth costs it ~28 dB at the carrier
        const B = far + 0.04 * adj;
        const dFar = dFarBase + (off > 0 ? 1 : -1) * 0.8;

        // TV sync separator
        // (the slicer works on noisy demodulated luma: weak RF jitters the
        // edge, then drops pulses, then fires on noise)
        let m = null;
        const thr = 0.16;
        const lvl = Math.max(A, B);
        if (A > thr && A > 1.6 * B) m = eLine + gauss() * 0.04 / A;
        else if (B > thr && B > 1.6 * A) m = eLine + dFar + gauss() * 0.04 / B;
        else {
          const u = rnd();
          if (u < 0.12) m = eLine + (rnd() - 0.5) * 420;
          else if (u < 0.12 + 0.35 * (lvl / thr) ** 2) m = eLine + (A > B ? 0 : dFar) + gauss() * 5;
        }
        // dropouts eat the sync too, if they land on it
        const dl = drops.get(l);
        if (dl && m !== null) for (const d of dl) if (d[0] < 70 && d[0] + d[1] > 0 && d[2] < 0.1) m = null;

        // TV horizontal AFC: flywheel PLL with a limited phase-detector range
        if (m !== null) {
          const err = Math.max(-70, Math.min(70, wrapLine(m - s.P)));
          s.P += s.F + 0.28 * err;
          s.F += 0.018 * err;
        } else {
          s.F += (5.5 - s.F) * 0.05; // the AFC voltage sags to the free-running hold
          s.P += s.F;
        }
        s.F = Math.max(-12, Math.min(12, s.F));
        s.P = wrapLine(s.P);

        // VCR colour-under AFC: locked to playback hsync. Lost, its VCO runs
        // free and the up-converted chroma slides in frequency.
        const vcrSync = A > 0.22 || B > 0.22;
        if (vcrSync && Math.abs(speedErr) < 0.35) {
          s.afcLocked = Math.min(1, s.afcLocked + 0.025);
        } else {
          s.afcLocked = Math.max(0, s.afcLocked - 0.05);
          if (rnd() < 0.002) s.vcoSign *= -1;
        }
        const rFree = s.vcoSign * (TAU * 0.016) / FS; // ~16 kHz off, rad/sample
        const target = (1 - s.afcLocked) * rFree;
        s.vRate += (target - s.vRate) * 0.15;
        s.vPhase += s.vRate * LINE;
        if (s.afcLocked > 0.95) s.vPhase *= 0.7; // APC pulls phase home
        s.vPhase += gauss() * 0.02 * sg;
        s.vPhase = wrapPi(s.vPhase);

        // TV burst APC and colour killer
        const Ac = Math.max(A, far);
        const burstGood = Ac > 0.22 && (!dl || !dl.some((d) => d[0] < 120 && d[0] + d[1] > 70));
        s.burstAvg += ((burstGood ? Ac : 0) - s.burstAvg) * 0.004;
        if (s.burstAvg < 0.18) s.killer = Math.max(0, s.killer - 0.006);
        else if (s.burstAvg > 0.3) s.killer = Math.min(1, s.killer + 0.01);
        if (burstGood) {
          const burstPhase = s.vPhase + s.vRate * 94;
          s.tvPhase += 0.12 * wrapPi(burstPhase - s.tvPhase);
        } else {
          s.tvPhase += 0.0004;
        }
        s.tvPhase = wrapPi(s.tvPhase);

        // AFM carriers: phase at the line's first tape sample and frequency
        // (cycles per sample) for this line
        const [dl0, dr0] = afmDev(tf + l / 15734);
        const fl = (AFM_L + dl0 * 1e-6) / FS;
        const fr = (AFM_R + dr0 * 1e-6) / FS;

        const o = row * PARAM_COLS * 4;
        out[o + 0] = eLine;
        out[o + 1] = A;
        out[o + 2] = B;
        out[o + 3] = dFar;
        out[o + 4] = s.P;
        out[o + 5] = s.vPhase;
        out[o + 6] = s.vRate;
        out[o + 7] = 0;
        const d0 = dl?.[0];
        const d1 = dl?.[1];
        out[o + 8] = d0 ? d0[0] : -1;
        out[o + 9] = d0 ? d0[1] : 0;
        out[o + 10] = d1 ? d1[0] : -1;
        out[o + 11] = d1 ? d1[1] : 0;
        out[o + 12] = sigma;
        out[o + 13] = l === SWITCH_LINE ? switchX : -1;
        out[o + 14] = switchJump;
        out[o + 15] = (d0 ? d0[2] : 1) + (d1 ? d1[2] : 1) * 0; // depth of first dropout
        out[o + 16] = s.tvPhase;
        out[o + 17] = s.killer;
        out[o + 18] = adj;
        out[o + 19] = d1 ? d1[2] : 1;
        out[o + 20] = s.afmL;
        out[o + 21] = s.afmR;
        out[o + 22] = fl;
        out[o + 23] = fr;
        s.afmL = (s.afmL + fl * LINE) % 1;
        s.afmR = (s.afmR + fr * LINE) % 1;
      }

      // vertical: the TV's oscillator only takes a vsync inside its window
      const vl = 4;
      const offV = lateral(vl);
      const Av = overlap(offV, 0);
      const Bv = overlap(offV, 2) + overlap(offV, -2);
      const vsync = (Av > 0.2 && Av > 1.4 * Bv) || (Bv > 0.2 && Bv > 1.4 * Av);
      const r = ((s.roll % 263) + 263) % 263;
      const dist = Math.min(r, 263 - r);
      if (vsync && dist < 34) s.roll = 0;
      else s.roll = (s.roll + 2.8) % 263;

    }
    s.frame++;
    return { params: out, roll: Math.round(s.roll), g };
  }

  return { step, state: s };
}
