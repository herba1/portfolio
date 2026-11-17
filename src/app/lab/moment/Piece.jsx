"use client";

import { makePiece } from "../_kit/makePiece";
import "./moment.css";

export default makePiece("moment", () => import("./momentEngine").then((m) => m.createMoment));
