"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("lanyard", () => import("./lanyardEngine").then((m) => m.createLanyard));
