"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("blue-hour", () => import("./blueHourEngine").then((m) => m.createBlueHour));
