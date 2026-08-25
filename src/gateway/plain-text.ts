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

// The lint that forbids naming a control character is disabled for the one pattern whose SUBJECT is
// control characters: the rule exists to catch one that wandered in by accident, and these are here
// on purpose.
const REPAINTS = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069\\ufeff]",
  "g",
);

export const plainText = (raw: string, max = 300): string =>
  raw.replace(REPAINTS, " ").slice(0, max);
