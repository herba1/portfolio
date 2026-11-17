"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("programme", () => import("./programmeEngine").then((m) => m.createProgramme));
