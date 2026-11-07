"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("look-up", () => import("./lookUpEngine").then((m) => m.createLookUp));
