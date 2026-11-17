"use client";

import { makePiece } from "../_kit/makePiece";
import "./sequin.css";

export default makePiece("sequin", () => import("./sequinEngine").then((m) => m.createSequin));
