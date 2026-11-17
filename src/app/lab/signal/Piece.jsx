"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("signal", () => import("./signalEngine").then((m) => m.createSignal));
