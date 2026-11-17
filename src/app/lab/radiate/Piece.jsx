"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("radiate", () => import("./radiateEngine").then((m) => m.createRadiate));
