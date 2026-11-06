"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("sand", () => import("./sandEngine").then((m) => m.createSand));
