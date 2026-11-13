export function appendRefusal(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  const marker = "malformed law:";
  const at = detail.indexOf(marker);
  const why = at === -1 ? detail : detail.slice(at + marker.length);
  return why.trim() === "" ? detail : why.trim();
}

const MAX_CONTAINER_NAME = 512;
const MAX_CONTAINER_DEPTH = 16;
const NUL = "\u0000";

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
