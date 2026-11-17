"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("crossing", () => import("./crossingEngine").then((m) => m.createCrossing));
