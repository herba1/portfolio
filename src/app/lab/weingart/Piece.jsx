"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("weingart", () => import("./weingartEngine").then((m) => m.createWeingart));
