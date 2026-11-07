"use client";

import { makePiece } from "../_kit/makePiece";
import "./yuudachi.css";

export default makePiece("yuudachi", () => import("./yuudachiEngine").then((m) => m.createYuudachi));
