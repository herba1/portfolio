/* ─────────────────────────────────────────────────────────────────────────
   Springs.

   HOW IOS ACTUALLY DOES THIS, since that is the question:

     · there is no path. An icon flying into the Dynamic Island travels in a
       STRAIGHT LINE. The curve people think they see is the scale changing,
       not the position bending.
     · there is no rotation. Not a degree, ever.
     · there are no keyframes and no easing curve. Position, scale and corner
       radius are all driven by ONE spring — the same spring, the same instant.
       That is the entire reason it reads as a single physical object instead
       of several properties that were animated to agree.
     · the destination reacts. The Island expands to receive the thing.

   And it has TWO numbers: duration and bounce. Not fifty.

   That last part is not a coincidence, it is the point. A spring is a physical
   system, so every property attached to one is already in agreement — there is
   nothing left to tune INTO agreement. All the knobs we have been adding exist
   to reconcile independent timelines that a spring never creates.

   ── The parameterisation ────────────────────────────────────────────────
   SwiftUI's `Spring(duration:bounce:)`, because mass/stiffness/damping is not
   a thing anyone can hold in their head:

     bounce  0    settles with no overshoot at all
             0.2  a small, confident overshoot — this is the iOS house style
             0.5  visibly springy
             <0   overdamped, arrives slowly and never overshoots

   duration is PERCEPTUAL: roughly when it looks finished, not when the maths
   stops. A spring is asymptotic and never truly arrives, so the real settle
   time is longer and is computed below rather than guessed at.
   ───────────────────────────────────────────────────────────────────────── */

/* Unit step response of a damped harmonic oscillator, released from rest.
   Returns a function of time in ms, and the time by which it has settled. */
export function spring(durationMs, bounce) {
  // SwiftUI's mapping, so the numbers mean what they mean everywhere else.
  const zeta = bounce >= 0 ? 1 - bounce : 1 / (1 + bounce);
  const omega = (2 * Math.PI) / (durationMs / 1000); // rad/s
  const z = Math.max(0.0001, zeta);

  let at;
  if (Math.abs(z - 1) < 1e-4) {
    // Critically damped: the fastest approach with no overshoot.
    at = (t) => 1 - Math.exp(-omega * t) * (1 + omega * t);
  } else if (z < 1) {
    const wd = omega * Math.sqrt(1 - z * z);
    at = (t) =>
      1 -
      Math.exp(-z * omega * t) *
        (Math.cos(wd * t) + ((z * omega) / wd) * Math.sin(wd * t));
  } else {
    const r = omega * Math.sqrt(z * z - 1);
    const r1 = -omega * z + r;
    const r2 = -omega * z - r;
    at = (t) => 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  }

  /* When to stop. The envelope decays as e^(−ζωt), so the moment it is within
     half a percent is −ln(0.005)/(ζω). Clamped, because a very low bounce
     would otherwise run for a second and a half of invisible settling. */
  const settleS = Math.min(4 * (durationMs / 1000), 5.3 / (z * omega));

  return {
    // t in ms, from 0
    at: (t) => at(Math.max(0, t) / 1000),
    settle: Math.max(durationMs * 0.6, settleS * 1000),
  };
}

/* Sample a spring into WAAPI keyframes. Everything driven by the returned
   progress moves as one system, which is the whole trick — position and scale
   are not two animations that were timed to match, they are two readings of
   the same number. */
export function sampleSpring(durationMs, bounce, N = 60) {
  const s = spring(durationMs, bounce);
  const rows = [];
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const p = i === N ? 1 : s.at(u * s.settle);
    rows.push({ u, p });
  }
  return { rows, settle: s.settle };
}
