"use client";

import { makePiece } from "../_kit/makePiece";
import "./natsu.css";

export default makePiece("natsu", () => import("./natsuEngine").then((m) => m.createNatsu));
