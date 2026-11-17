"use client";

import { Newsreader } from "next/font/google";
import { makePiece } from "../_kit/makePiece";
import "./optical.css";

// Newsreader (Production Type, OFL): a real optical-size axis, 6–72.
// At 6 it is a sturdy, wide, low-contrast text face with open counters;
// at 72 a sharp, high-contrast display cut with tight fit.
const news = Newsreader({ subsets: ["latin"], axes: ["opsz"], style: ["normal"], display: "block" });

export default makePiece("optical", () =>
  import("./opticalEngine").then((m) => (host, opts) => m.createOptical(host, { ...opts, family: news.style.fontFamily })),
);
