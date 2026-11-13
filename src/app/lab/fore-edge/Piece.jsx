"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("fore-edge", () => import("./foreEdgeEngine").then((m) => m.createForeEdge));
