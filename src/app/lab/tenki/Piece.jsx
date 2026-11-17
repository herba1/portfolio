"use client";

import { makePiece } from "../_kit/makePiece";
import "./tenki.css";

export default makePiece("tenki", () => import("./tenkiEngine").then((m) => m.createTenki));
