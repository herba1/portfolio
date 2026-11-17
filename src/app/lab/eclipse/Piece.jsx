"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("eclipse", () => import("./eclipseEngine").then((m) => m.createEclipse));
