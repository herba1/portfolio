"use client";

import { Anton } from "next/font/google";
import { makePiece } from "../_kit/makePiece";

// A condensed gothic in the manner of the wood type poster shops set big.
const anton = Anton({ weight: "400", subsets: ["latin"], display: "block" });

export default makePiece("split-fount", () =>
  import("./splitFountEngine").then((m) => (host, opts) => m.createSplitFount(host, { ...opts, family: anton.style.fontFamily })),
);
