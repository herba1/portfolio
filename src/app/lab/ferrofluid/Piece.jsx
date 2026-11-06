"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("ferrofluid", () => import("./ferroEngine").then((m) => m.createFerro));
