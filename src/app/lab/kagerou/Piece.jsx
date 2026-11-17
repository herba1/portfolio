"use client";

import { makePiece } from "../_kit/makePiece";
import "./kagerou.css";

export default makePiece("kagerou", () => import("./kagerouEngine").then((m) => m.createKagerou));
