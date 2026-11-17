"use client";

import { makePiece } from "../_kit/makePiece";
import "./komorebi.css";

export default makePiece("komorebi", () => import("./komorebiEngine").then((m) => m.createKomorebi));
