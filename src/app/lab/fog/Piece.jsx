"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("fog", () => import("./fogEngine").then((m) => m.createFog));
