const GEIST_600_ADVANCES = [
  236, 243, 376, 552, 656, 818, 677, 195, 306, 306, 424, 566, 225, 418, 225, 508, 683, 427, 642, 637, 643, 656, 615, 538, 644,
  618, 306, 306, 548, 548, 548, 581, 944, 709, 695, 724, 708, 615, 600, 726, 719, 290, 617, 672, 586, 902, 748, 763, 664, 757,
  689, 668, 584, 699, 709, 991, 660, 613, 577, 375, 485, 375, 450, 560, 268, 580, 621, 580, 621, 591, 429, 620, 601, 269, 308,
  628, 297, 892, 601, 603, 621, 621, 409, 553, 427, 597, 584, 839, 628, 570, 567, 401, 284, 401, 523,
];
const CURLY_APOSTROPHE_ADVANCE = 232;
const FALLBACK_ADVANCE = 600;
const KERNING_ALLOWANCE = 0.986;
const TRACKING_K = 0.043;
const TRACKING_PIVOT_PX = 12;
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 760;
const SPLIT_GAIN = 1.25;

export const GEIST_ASCENT_EM = 1.005;
export const GEIST_CAP_EM = 0.71;

const advanceOf = (char) => {
  if (char === "’") return CURLY_APOSTROPHE_ADVANCE;
  const code = char.charCodeAt(0) - 32;
  return GEIST_600_ADVANCES[code] ?? FALLBACK_ADVANCE;
};

function measureRun(chars) {
  let em = 0;
  for (const char of chars) em += advanceOf(char) / 1000;
  const gaps = Math.max(0, chars.length - 1);
  return {
    text: chars.join(""),
    divisor: em * KERNING_ALLOWANCE - TRACKING_K * gaps,
    gapPx: TRACKING_K * TRACKING_PIVOT_PX * gaps,
  };
}

const fitWidth = (run, width) => (width - run.gapPx) / Math.max(run.divisor, 0.1);

export function estimateProxy(title) {
  const chars = Array.from(title || "");
  const whole = measureRun(chars);
  let split = null;
  chars.forEach((char, at) => {
    if (char !== " ") return;
    const first = measureRun(chars.slice(0, at));
    const second = measureRun(chars.slice(at + 1));
    const size = Math.min(fitWidth(first, PHONE_WIDTH * 0.9), fitWidth(second, PHONE_WIDTH * 0.9));
    if (!split || size > split.size) split = { size, first, second };
  });
  const single = Math.min(fitWidth(whole, PHONE_WIDTH * 0.9), PHONE_HEIGHT * 0.2, 420);
  const splitSize = split ? Math.min(split.size, PHONE_HEIGHT * 0.2 * 0.78, 420) : 0;
  const narrowRows = split && splitSize > single * SPLIT_GAIN ? [split.first, split.second] : [whole];
  const style = {
    "--taffy-whole-divisor": whole.divisor.toFixed(4),
    "--taffy-whole-gap": `${whole.gapPx.toFixed(3)}px`,
  };
  if (narrowRows.length === 2) {
    style["--taffy-first-divisor"] = narrowRows[0].divisor.toFixed(4);
    style["--taffy-first-gap"] = `${narrowRows[0].gapPx.toFixed(3)}px`;
    style["--taffy-second-divisor"] = narrowRows[1].divisor.toFixed(4);
    style["--taffy-second-gap"] = `${narrowRows[1].gapPx.toFixed(3)}px`;
  }
  return { whole: whole.text, narrow: narrowRows.map((row) => row.text), style };
}
