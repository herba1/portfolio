"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("miniature", () => import("./miniatureEngine").then((m) => m.createMiniature));
