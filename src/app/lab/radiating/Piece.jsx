"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("radiating", () => import("./radiatingEngine").then((m) => m.createRadiating));
