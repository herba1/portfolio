"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("no-cover", () => import("./noCoverEngine").then((m) => m.createNoCover));
