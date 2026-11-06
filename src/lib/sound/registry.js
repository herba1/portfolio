// Every bank of takes the worker can render, by the key each *Takes.js gives
// itself with label(). A new piece with sound adds a line here (sound-check
// fails until it does).
export const TAKES = {
  "lab/blob-track/blobTakes": () => import("../../app/lab/blob-track/blobTakes.js"),
  "lab/coverflow/tickTakes": () => import("../../app/lab/coverflow/tickTakes.js"),
  "lab/crumple/crumpleTakes": () => import("../../app/lab/crumple/crumpleTakes.js"),
  "lab/drum/detentTakes": () => import("../../app/lab/drum/detentTakes.js"),
  "lab/field/fieldTakes": () => import("../../app/lab/field/fieldTakes.js"),
  "lab/focus-pull/lensTakes": () => import("../../app/lab/focus-pull/lensTakes.js"),
  "lab/generation-loss/shutterTakes": () => import("../../app/lab/generation-loss/shutterTakes.js"),
  "lab/harmonograph/penTakes": () => import("../../app/lab/harmonograph/penTakes.js"),
  "lab/hold-menu/foleyTakes": () => import("../../app/lab/hold-menu/foleyTakes.js"),
  "lab/interruptions/penTakes": () => import("../../app/lab/interruptions/penTakes.js"),
  "lab/iris/irisTakes": () => import("../../app/lab/iris/irisTakes.js"),
  "lab/justify/justifyTakes": () => import("../../app/lab/justify/justifyTakes.js"),
  "lab/kern/kernTakes": () => import("../../app/lab/kern/kernTakes.js"),
  "lab/ligature/ligatureTakes": () => import("../../app/lab/ligature/ligatureTakes.js"),
  "lab/moire/moireTakes": () => import("../../app/lab/moire/moireTakes.js"),
  "lab/pull-vinyl/vinylTakes": () => import("../../app/lab/pull-vinyl/vinylTakes.js"),
  "lab/refractor/refractorTakes": () => import("../../app/lab/refractor/refractorTakes.js"),
  "lab/select/selectTakes": () => import("../../app/lab/select/selectTakes.js"),
  "lab/smear/smearTakes": () => import("../../app/lab/smear/smearTakes.js"),
  "lab/steam/steamTakes": () => import("../../app/lab/steam/steamTakes.js"),
  "lab/t9/t9Takes": () => import("../../app/lab/t9/t9Takes.js"),
  "lab/tempo-wheel/tempoTakes": () => import("../../app/lab/tempo-wheel/tempoTakes.js"),
  "lab/terminal/terminalTakes": () => import("../../app/lab/terminal/terminalTakes.js"),
  "scorch/scorchTakes": () => import("../../app/scorch/scorchTakes.js"),
};
