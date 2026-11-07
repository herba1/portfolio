"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("phase", () => import("./phaseEngine").then((m) => m.createPhase));
