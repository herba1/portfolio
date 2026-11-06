"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("blinds", () => import("./blindsEngine").then((m) => m.createBlinds));
