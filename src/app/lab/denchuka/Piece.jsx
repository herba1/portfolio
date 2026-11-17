"use client";

import { makePiece } from "../_kit/makePiece";
import "./denchuka.css";

export default makePiece("denchuka", () => import("./denchukaEngine").then((m) => m.createDenchuka));
