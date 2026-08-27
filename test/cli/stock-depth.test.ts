// T244 — depth is declared per edge (working spec §50, criterion 6; story 1).
//
// Org nests its members through the ShallowPerson reading: a member's id and name reach the org
// view, and the member's follows do NOT — that is what keeps "nest a person" from returning the
// graph. Asserted at BOTH levels, and the second is the one the premortem demanded (finding 10):
//
//   • OBJECT level, through the GraphQL door: the nested member view carries `name` and no
//     `follows`.
//   • GATHER level, `_view` on the ShallowPerson reading itself: the narrowed program's bucket
//     set is exactly its declared props. A ShallowPerson that merely HID follows at one door —
//     a Schema-narrowing over the full gather — would pass the first assertion and leak the
//     follow graph through every other surface; `_view` shows the buckets the gather actually
//     admitted, so it catches the narrowing done in the wrong layer.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../src/cli/cli.js";

vi.setConfig({ testTimeout: 20000 });

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-stock-depth-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function serveDetached(
  args: readonly string[],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(["serve", "--http", ...args], io(), { detach: true });
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

const gql = async (
  url: string,
  query: string,
): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }> => {
  const res = await fetch(`${url}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
};

describe("org nests members shallow — story 1, end to end", () => {
  it("a member's name reaches the org view and the member's follows do not", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);

    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      // Ada exists: a name (the shallow reading's one bucket) and a follow (the graph the
      // shallow reading must NOT carry into org).
      let res = await gql(
        handle.url,
        `mutation { person(entity: "person:ada", name: "Ada", bio: "gardener") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      res = await gql(
        handle.url,
        `mutation { linkperson_follows(entity: "person:ada", target: "person:bob") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      res = await gql(
        handle.url,
        `mutation { org(entity: "org:labs", name: "Bombadil Labs") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      res = await gql(
        handle.url,
        `mutation { linkOrg(entity: "org:labs", field: "members", target: "person:ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      // OBJECT LEVEL: the nested member is a ShallowPerson view — id and name, nothing more.
      const read = await gql(handle.url, `{ org(entity: "org:labs") { name members } }`);
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      const org = read.data?.["org"] as { name: string; members: unknown };
      expect(org.name).toBe("Bombadil Labs");
      const members = (Array.isArray(org.members) ? org.members : [org.members]) as Record<
        string,
        unknown
      >[];
      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({ name: "Ada" });
      expect(members[0], "the shallow reading must not carry the graph").not.toHaveProperty(
        "follows",
      );
      expect(members[0]).not.toHaveProperty("bio");

      // GATHER LEVEL: the ShallowPerson program's buckets are exactly its declared props. Ada
      // HAS name, bio, and follows claims; the narrowed gather admits only the name context.
      const shallow = await gql(handle.url, `{ shallowPerson(entity: "person:ada") { _view } }`);
      expect(shallow.errors, JSON.stringify(shallow.errors)).toBeUndefined();
      const view = (shallow.data?.["shallowPerson"] as { _view: Record<string, unknown> })._view;
      expect(Object.keys(view).sort(), "buckets the gather admitted").toEqual(["name"]);

      // And the full Person reading still sees everything — narrowing lives in ShallowPerson's
      // program, not in Person's data.
      const person = await gql(handle.url, `{ person(entity: "person:ada") { name bio follows } }`);
      expect(person.data?.["person"]).toMatchObject({
        name: "Ada",
        bio: "gardener",
        follows: ["person:bob"],
      });
    } finally {
      await handle.close();
    }
  });
});
