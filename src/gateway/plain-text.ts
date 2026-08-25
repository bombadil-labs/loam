// TEXT AN UNTRUSTED PARTY WROTE, ON ITS WAY TO A PERSON (SPEC §30's discipline, T172). Two sources
// feed it today and both are chosen by a peer: the message a renderer bundle's own error carries, and
// the `route` off a federated binding, where the publish door's "no `/` or NUL" rule never ran. Either
// lands in an operator's terminal and log.
//
// Two jobs. Drop everything that REPAINTS — C0/C1 carries ESC and BEL, and the bidi and format ranges
// are the half a plain control-character filter misses, where U+202E alone prints a refusal as its own
// opposite. Then cap the length, so a refusal cannot scroll a screen.
//
// IT LIVES IN ITS OWN MODULE, and that is the point rather than tidiness. `render-worker.ts` is
// Node-only and is STUBBED out of every browser-safe bundle, so a copy of this rule living there
// would need a second copy in the stub — two spellings of one security control, free to drift, in the
// file whose whole job is to be the boundary. This is pure string work with no host in it, so both
// peers import the same one.
//
// The worker ALSO scrubs its own copy of a refusal before posting it. That copy runs in the bundle's
// realm, through prototype methods the bundle can replace, so it is advisory; this call is the one
// that counts, and the parent makes it on every string that crosses.

// The ranges that REPAINT, as code-point pairs — C0/C1 (ESC, BEL), then the bidi and format ranges a
// plain control filter misses, where U+202E alone prints a refusal as its own opposite. Built from
// numbers at runtime rather than written as a control-char regex literal: the pattern's SUBJECT is
// control characters on purpose, and constructing the class from code points keeps a real control byte
// out of this source (which is what `no-control-regex` guards) without a blanket disable.
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
