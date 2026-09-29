// The gateway's own alphabet: NUL separates the segments of internal materialization names and
// comparison keys, and register() refuses it in schema names, so nothing user-supplied collides.
export const NUL = "\u0000";
