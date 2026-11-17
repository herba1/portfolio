"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("shutter", () => import("./shutterEngine").then((m) => m.createShutter));
