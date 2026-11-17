"use client";

import { makePiece } from "../_kit/makePiece";
import "./weingart.css";

export default makePiece("weingart", () => import("./weingartEngine").then((m) => m.createWeingart));
