"use client";

import { Anybody } from "next/font/google";
import { makePiece } from "../_kit/makePiece";

// Anybody (Etcetera Type Co, SIL OFL 1.1): a variable face whose width axis
// runs down to 50%, drawn ultra-condensed at 900 rather than squeezed, so
// its stems hold their weight. The nearest open relative of Druk's
// condensed super weights.
const anybody = Anybody({ subsets: ["latin"], axes: ["wdth"], display: "block" });

export default makePiece("drum", () =>
  import("./drumEngine").then((m) => (host, opts) => m.createDrum(host, { ...opts, family: anybody.style.fontFamily })),
);
