"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("torn", () => import("./tornEngine").then((m) => m.createTorn));
