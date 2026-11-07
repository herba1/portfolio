"use client";

import { makePiece } from "../_kit/makePiece";
import "./catenary.css";

export default makePiece("catenary", () => import("./catenaryEngine").then((m) => m.createCatenary));
