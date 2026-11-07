"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("new-alphabet", () => import("./alphabetEngine").then((m) => m.createAlphabet));
