"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("overprint", () => import("./overprintEngine").then((m) => m.createOverprint));
