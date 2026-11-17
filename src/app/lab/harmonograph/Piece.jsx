"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("harmonograph", () => import("./harmonographEngine").then((m) => m.createHarmonograph));
