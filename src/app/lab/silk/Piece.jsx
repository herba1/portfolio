"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("silk", () => import("./silkEngine").then((m) => m.createSilk));
