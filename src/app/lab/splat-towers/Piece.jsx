"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("splat-towers", () => import("./splatTowersEngine").then((m) => m.createSplatTowers));
