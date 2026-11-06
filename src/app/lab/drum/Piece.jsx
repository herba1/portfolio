"use client";

import { Anton } from "next/font/google";
import { makePiece } from "../_kit/makePiece";

// Anton (Vernon Adams, SIL OFL 1.1): the nearest open face to Druk's heavy
// condensed sans. Compressed further in the engine to Druk's proportions.
const anton = Anton({ weight: "400", subsets: ["latin"], display: "block" });

export default makePiece("drum", () =>
  import("./drumEngine").then((m) => (host, opts) => m.createDrum(host, { ...opts, family: anton.style.fontFamily })),
);
