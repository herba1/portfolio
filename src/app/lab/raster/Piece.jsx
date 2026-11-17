"use client";

import { makePiece } from "../_kit/makePiece";

export default makePiece("raster", () => import("./rasterEngine").then((m) => m.createRaster));
