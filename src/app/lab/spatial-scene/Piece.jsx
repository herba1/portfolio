"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("spatial-scene", () => import("./spatialEngine").then((m) => m.createSpatial));
