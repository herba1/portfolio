"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("oramics", () => import("./oramicsEngine").then((m) => m.createOramics));
