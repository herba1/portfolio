"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("overexpose", () => import("./overexposeEngine").then((m) => m.createOverexpose));
