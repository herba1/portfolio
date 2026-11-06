"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("pin-art", () => import("./pinEngine").then((m) => m.createPins));
