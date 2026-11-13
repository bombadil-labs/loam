const REPAINT_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const REPAINTS = new RegExp(
  `[${REPAINT_RANGES.map(([lo, hi]) => `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`).join("")}]`,
  "gu",
);

export const plainText = (raw: string, max = 300): string =>
  raw.replace(REPAINTS, " ").slice(0, max);
