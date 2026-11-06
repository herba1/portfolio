"use client";

import { makePiece } from "../_kit/makePiece";
import "./afternoon.css";

export default makePiece("afternoon", () => import("./afternoonEngine").then((m) => m.createAfternoon));
