"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("develop", () => import("./developEngine").then((m) => m.createDevelop));
