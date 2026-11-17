"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("blue-note", () => import("./sleeveEngine").then((m) => m.createSleeve));
