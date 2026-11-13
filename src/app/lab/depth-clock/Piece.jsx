"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("depth-clock", () => import("./depthClockEngine").then((m) => m.createDepthClock));
