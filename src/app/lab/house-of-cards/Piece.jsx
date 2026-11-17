"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("house-of-cards", () => import("./cloudEngine").then((m) => m.createCloud));
