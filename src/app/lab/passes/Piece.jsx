"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("passes", () => import("./passesEngine").then((m) => m.createPasses));
