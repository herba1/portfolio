"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("fade", () => import("./fadeEngine").then((m) => m.createFade));
