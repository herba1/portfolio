"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("dots", () => import("./dotsEngine").then((m) => m.createDots));
