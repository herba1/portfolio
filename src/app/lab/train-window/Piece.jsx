"use client";

import { makePiece } from "../_kit/makePiece";
import "./trainWindow.css";

export default makePiece("train-window", () => import("./trainWindowEngine").then((m) => m.createTrainWindow));
