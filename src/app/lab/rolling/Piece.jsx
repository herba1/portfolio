"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("rolling", () => import("./rollingEngine").then((m) => m.createRolling));
