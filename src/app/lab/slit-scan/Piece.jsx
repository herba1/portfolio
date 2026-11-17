"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("slit-scan", () => import("./slitScanEngine").then((m) => m.createSlitScan));
