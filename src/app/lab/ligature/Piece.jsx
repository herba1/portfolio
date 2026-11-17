"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("ligature", () => import("./ligatureEngine").then((m) => m.createLigature));
