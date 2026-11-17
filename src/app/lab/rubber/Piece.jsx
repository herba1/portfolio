"use client";

import { M_PLUS_Rounded_1c } from "next/font/google";
import { makePiece } from "../_kit/makePiece";

// A maru gothic: rounded terminals drawn, not just filleted, like GT Maru.
const maru = M_PLUS_Rounded_1c({ weight: "800", subsets: ["latin"], display: "block" });

export default makePiece("rubber", () =>
  import("./rubberEngine").then((m) => (host, opts) => m.createRubber(host, { ...opts, family: maru.style.fontFamily })),
);
