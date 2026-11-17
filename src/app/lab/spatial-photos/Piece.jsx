"use client";

import { makePiece } from "../_kit/makePiece";
import "./spatialPhotos.css";

export default makePiece("spatial-photos", () => import("./spatialPhotosEngine").then((m) => m.createSpatialPhotos));
