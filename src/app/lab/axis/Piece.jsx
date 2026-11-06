"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("axis", () => import("./axisEngine").then((m) => m.createAxis));
