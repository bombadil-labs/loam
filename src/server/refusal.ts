/**
 * What an append refused, in its own words.
 *
 * A container defect arrives wrapped as `malformed law: <why>`, and the wrapper carries nothing a
 * caller can act on. Slicing on the marker's index alone silently cuts thirteen characters off
 * every OTHER failure — the store can no longer persist, the id is tombstoned — so the refusal
 * that matters most is the one reported in a mangled sentence.
 *
 * ITS OWN MODULE because two doors need it, and those two doors already point at each other: the
 * HTTP door builds the admin door, so a helper living in either makes a cycle out of six lines.
 */
export function appendRefusal(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const marker = "malformed law:";
  const at = detail.indexOf(marker);
  const why = at === -1 ? detail : detail.slice(at + marker.length);
  return why.trim() === "" ? detail : why.trim();
}

// A container name a connection may mint. Both bounds are generous for any real subtree and finite
// for a caller that is not building one.
const MAX_CONTAINER_NAME = 512;
const MAX_CONTAINER_DEPTH = 16;
const NUL = "\u0000";

/**
 * Why this name is not one a bound connection may mint. Absent means it is. `fence` is the
 * caller's own container with its colon, and `given` must be strictly inside it.
 *
 * THE COLON IS NOT ENOUGH. A bare prefix test admits the fence itself — `ada:journal:`, an empty
 * final segment — which stands as a container whose listed name reads as its parent's prefix and
 * whose own children's fence doubles the colon. The bounds are not decoration either: every name
 * minted here becomes permanent operator-signed law, the roads that mint one declare every missing
 * level with it, and the reach walks are fixpoints over the whole table. One request should not be
 * able to spend the store's future reads.
 *
 * SHARED BY EVERY ROAD THAT MINTS FROM A CONNECTION'S NAME — the roster's `declare` and the
 * receive door, which hands `into` to a walk that declares every missing level. A rule one road
 * asks is a rule the other does not.
 */
export function mintableNameDefect(fence: string, given: string): string | undefined {
  if (!given.startsWith(fence) || given.length === fence.length) {
    return (
      "a connection names only what is inside its own container — the path and its colon — and " +
      `this name is outside ${fence}`
    );
  }
  if (given.includes(NUL)) return "a container name carries no NUL";
  if (given.length > MAX_CONTAINER_NAME) {
    return `a container name is at most ${MAX_CONTAINER_NAME} characters, and this one is longer`;
  }
  const under = given.slice(fence.length).split(":");
  if (under.length > MAX_CONTAINER_DEPTH) {
    return `a connection names at most ${MAX_CONTAINER_DEPTH} levels below its own container`;
  }
  return under.every((segment) => segment.length > 0)
    ? undefined
    : "every level of a container name is a name, and this one has an empty level";
}
