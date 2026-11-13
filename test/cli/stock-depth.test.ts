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

      const shallow = await gql(handle.url, `{ shallowPerson(entity: "person:ada") { _view } }`);
      expect(shallow.errors, JSON.stringify(shallow.errors)).toBeUndefined();
      const view = (shallow.data?.["shallowPerson"] as { _view: Record<string, unknown> })._view;
      expect(Object.keys(view).sort(), "buckets the gather admitted").toEqual(["name"]);

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
