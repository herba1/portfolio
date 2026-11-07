"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("zigzag", () => import("./zigzagEngine").then((m) => m.createZigzag));
