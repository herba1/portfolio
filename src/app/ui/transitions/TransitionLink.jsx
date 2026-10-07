"use client";

import Link from "next/link";
import { NAV_BACK } from "./types";

const BACK = [NAV_BACK];

export default function TransitionLink({ back = false, transitionTypes, ...props }) {
  return <Link transitionTypes={transitionTypes ?? (back ? BACK : undefined)} {...props} />;
}
