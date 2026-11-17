"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("interruptions", () => import("./interruptionsEngine").then((m) => m.createInterruptions));
