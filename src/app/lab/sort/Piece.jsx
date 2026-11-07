"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("sort", () => import("./sortEngine").then((m) => m.createSort));
