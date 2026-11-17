"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("snap-on", () => import("./snapEngine").then((m) => m.createSnapOn));
