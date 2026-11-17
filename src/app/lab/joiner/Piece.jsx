"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("joiner", () => import("./joinerEngine").then((m) => m.createJoiner));
