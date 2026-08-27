// T247 — `loam_docs`: the store hands a connected agent its own manual, at the moment of refusal.
//
// What this file asserts, criterion by criterion (working spec §53):
//   (a) the tool: listed read-only, no-args topic list, full markdown per topic, unknown topics
//       refused by naming the real ones;
//   (b) the register door's unknown-term-op refusal carries the parser's own words AND the pointer
//       to loam_docs — and ONLY that family does: authority, fence, absent-prop, and bad-pred
//       refusals stay pointer-free (two-sided);
//   (c) anti-drift, both directions: every op the served doc's §3 names is one the parser
//       recognizes, and every op the parser's own dispatch recognizes appears in the doc. The
//       parser-side expectation is derived from rhizomatic's shipped source and verified by
//       probing parseTerm — never copied from the doc under test (H10);
//   (d) the same bytes ride MCP resources: capabilities advertise `resources`, resources/list
//       names the topic, resources/read answers exactly what loam_docs answers;
//   (e) the instructions in `server/discover` and `initialize` name the tool, and are the same
//       string (an announcement the door does not honour is a report that can be false, H7);
//   (f) the anonymous door is unchanged: without a bearer, loam_docs draws the refusal its
//       siblings draw, compared response-against-response.
//
// Both levels, stated: the GROUND here is the committed compiled module and the docs/ file it is
// generated from (`build-docs --check`, byte-identity), and the READING is what the door serves —
// the last rail in this file binds the two, so the door cannot drift from the file and the file
// cannot drift from its generator.
//
// Deliberately NOT asserted: the CLI and admin register doors' refusal text — the pointer names an
// MCP tool, and it is the MCP-facing register door (both spellings: tools/call and POST /register)
// that wraps. Those doors keep the parser's raw words.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";

vi.setConfig({ testTimeout: 20_000 }); // a real listening server

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32); // authenticated, NO register standing
const SYLVIE_SEED = "51".repeat(32); // scoped register standing under sync:
const SYLVIE = authorForSeed(SYLVIE_SEED);

const POINTER = `loam_docs(topic: "register-grammar")`;
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const envelope = (name: string, body: unknown): Record<string, unknown> => ({
  hyperschema: { name, alg: 1, body },
  schema: { props: { name: PICK }, default: PICK },
  roots: [`${name}:1`],
});
const VALID_BODY = { op: "mask", policy: "drop", in: "input" };
const UNKNOWN_OP_BODY = { op: "latest", in: "input" };

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(
      grantClaims(STORE_ENTITY, SYLVIE, "register", OPERATOR, 9001, "sync:"),
      OPERATOR_SEED,
    ),
  ]);
  handle = await serve({
    mounts: { garden: gateway },
    tokens: {
      "op-token": { operator: true },
      "alice-token": { actor: ALICE_SEED },
      "sylvie-token": { actor: SYLVIE_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
});

const rpc = (body: Record<string, unknown>, token?: string): Promise<Response> =>
  fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  });

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const call = async (
  name: string,
  args: Record<string, unknown>,
  token = "alice-token",
): Promise<ToolResult> => {
  const res = await rpc({ method: "tools/call", params: { name, arguments: args } }, token);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: ToolResult; error?: { message: string } };
  expect(body.error, body.error?.message).toBeUndefined();
  return body.result!;
};

const grammar = async (): Promise<string> => {
  const result = await call("loam_docs", { topic: "register-grammar" });
  expect(result.isError).not.toBe(true);
  return result.content[0]!.text;
};

describe("(a) loam_docs: the tool", () => {
  it("tools/list serves it, and declares it read-only on the wire", async () => {
    const res = await rpc({ method: "tools/list", params: {} }, "alice-token");
    const tools = (
      (await res.json()) as {
        result: { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> };
      }
    ).result.tools;
    expect(tools.find((t) => t.name === "loam_docs")?.annotations?.readOnlyHint).toBe(true);
  });

  it("no arguments lists the topics, each with its one-line summary — not the full text", async () => {
    const listing = await call("loam_docs", {});
    expect(listing.isError).not.toBe(true);
    const text = listing.content[0]!.text;
    expect(text).toContain("register-grammar");
    expect(text).toContain("transcribed from the parsers"); // the summary rides the listing
    expect(text).not.toContain(`"op": "select"`); // the listing is not the doc
  });

  it("the topic returns the full compiled markdown", async () => {
    const md = await grammar();
    expect(md).toContain("# The Register Grammar");
    expect(md).toContain(`"op": "select"`);
  });

  it("an unknown topic refuses and names the topics it does serve", async () => {
    const refused = await call("loam_docs", { topic: "weeding" });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("register-grammar");
    expect(refused.content[0]!.text).not.toContain(`"op": "select"`);
  });
});

describe("(b) the register refusal points at the manual — and ONLY the unknown-op family does", () => {
  it("an unknown term op draws the parser's own words plus the pointer, on the MCP door", async () => {
    const refused = await call(
      "loam_register",
      envelope("sync:thing", UNKNOWN_OP_BODY),
      "op-token",
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/unknown term op/);
    expect(refused.content[0]!.text).toMatch(/latest/); // the parser's words survive the wrap
    expect(refused.content[0]!.text).toContain(POINTER);
  });

  it("the same wrap rides POST /register — the door's other spelling", async () => {
    const res = await fetch(`${base}/garden/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: JSON.stringify(envelope("sync:thing", UNKNOWN_OP_BODY)),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: string[] };
    expect(body.errors[0]).toMatch(/unknown term op/);
    expect(body.errors[0]).toContain(POINTER);
  });

  it("no standing draws the constitutional refusal, pointer-free", async () => {
    const refused = await call(
      "loam_register",
      envelope("sync:thing", UNKNOWN_OP_BODY),
      "alice-token",
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/operator token/);
    expect(refused.content[0]!.text).not.toContain("loam_docs");
  });

  it("a fence refusal is pointer-free — the caller's body was fine", async () => {
    const refused = await call(
      "loam_register",
      envelope("other:trellis", VALID_BODY),
      "sylvie-token",
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/operator token/);
    expect(refused.content[0]!.text).not.toContain("loam_docs");
  });

  it("an absent prop is pointer-free — a shape complaint is not a grammar lesson", async () => {
    const noRoots: Record<string, unknown> = { ...envelope("sync:thing", VALID_BODY) };
    delete noRoots["roots"];
    const refused = await call("loam_register", noRoots, "op-token");
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/roots must be/);
    expect(refused.content[0]!.text).not.toContain("loam_docs");
  });

  it("a bad predicate is pointer-free — near the family, not in it", async () => {
    const refused = await call(
      "loam_register",
      envelope("sync:thing", { op: "select", pred: { nope: 1 }, in: "input" }),
      "op-token",
    );
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toMatch(/pred must be/);
    expect(refused.content[0]!.text).not.toContain("loam_docs");
  });
});

// A minimal accepted body per documented op: the strong half of the probe. An op missing here is
// still probed as a bare `{ op }`, whose verdict distinguishes "unknown" from "refused for its
// arguments" — so a NEW parser op cannot dodge the rail by lacking a fixture.
const MINIMAL: Record<string, unknown> = {
  select: { op: "select", pred: "true", in: "input" },
  union: { op: "union", left: "input", right: "input" },
  intersect: { op: "intersect", left: "input", right: "input" },
  difference: { op: "difference", of: "input", without: "input" },
  mask: { op: "mask", policy: "drop", in: "input" },
  group: { op: "group", key: "byRole", in: "input" },
  prune: { op: "prune", keep: "all", in: "input" },
  expand: { op: "expand", role: { exact: "r" }, schema: "s", reading: "s", in: "input" },
  fix: { op: "fix", schema: "s", entity: "e" },
  resolve: { op: "resolve", schema: { default: PICK }, in: "input" },
};

const verdictOf = (op: string): "accepted" | "unknown" | "refused-otherwise" => {
  try {
    parseTerm(MINIMAL[op] ?? { op });
    return "accepted";
  } catch (err) {
    return /^unknown term op/.test(err instanceof Error ? err.message : String(err))
      ? "unknown"
      : "refused-otherwise";
  }
};

describe("(c) anti-drift: the served doc's §3 and the parser agree, both directions", () => {
  it("holds, and the probe itself can go red", async () => {
    // The probe's own teeth first: an invented op must read as unknown, or every assertion
    // below is vacuous.
    expect(verdictOf("latest")).toBe("unknown");

    // Doc side: the ops §3 of the SERVED bytes names.
    const md = await grammar();
    const from = md.indexOf("\n## 3.");
    const to = md.indexOf("\n## 4.");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const docOps = new Set([...md.slice(from, to).matchAll(/"op": "(\w+)"/g)].map((m) => m[1]!));
    expect(docOps.size).toBeGreaterThan(0);

    // Parser side: the dispatch labels of rhizomatic's own shipped parseTerm — read from the
    // subject, then each label verified against the live parser, never copied from the doc (H10).
    const require = createRequire(import.meta.url);
    const termJson = join(dirname(require.resolve("@bombadil/rhizomatic")), "term-json.js");
    const source = readFileSync(termJson, "utf8");
    const start = source.indexOf("export function parseTerm");
    expect(start).toBeGreaterThan(-1);
    const next = source.indexOf("\nexport ", start + 1);
    const fn = source.slice(start, next === -1 ? source.length : next);
    const parserOps = new Set([...fn.matchAll(/case "(\w+)":/g)].map((m) => m[1]!));
    expect(parserOps.has("select")).toBe(true); // the extraction found the dispatch, not a decoy
    for (const op of parserOps) {
      expect(verdictOf(op), `extracted "${op}" does not probe as a real op`).not.toBe("unknown");
    }

    // Direction one: no phantom — every op the doc teaches, the parser recognizes.
    for (const op of docOps) {
      expect(verdictOf(op), `the doc's §3 names "${op}" and the parser does not know it`).not.toBe(
        "unknown",
      );
      expect(parserOps.has(op), `the doc's §3 names "${op}" outside the parser's dispatch`).toBe(
        true,
      );
      if (MINIMAL[op] !== undefined) expect(verdictOf(op)).toBe("accepted");
    }
    // Direction two: no omission — every op the parser accepts, the doc teaches.
    for (const op of parserOps) {
      expect(docOps.has(op), `the parser accepts "${op}" and the served doc's §3 omits it`).toBe(
        true,
      );
    }
  });
});

describe("(d) resources: the same bytes, advertised", () => {
  it("initialize advertises the resources capability", async () => {
    const res = await rpc({ method: "initialize", params: {} }, "alice-token");
    const caps = ((await res.json()) as { result: { capabilities: Record<string, unknown> } })
      .result.capabilities;
    expect(caps["resources"]).toBeDefined();
  });

  it("resources/list names the topic", async () => {
    const res = await rpc({ method: "resources/list", params: {} }, "alice-token");
    const listed = (
      (await res.json()) as {
        result: { resources: Array<{ uri: string; name: string; mimeType?: string }> };
      }
    ).result.resources;
    const doc = listed.find((r) => r.uri === "loam://docs/register-grammar");
    expect(doc?.name).toBe("register-grammar");
    expect(doc?.mimeType).toBe("text/markdown");
  });

  it("resources/read answers exactly the bytes loam_docs answers — one compiled source", async () => {
    const res = await rpc(
      { method: "resources/read", params: { uri: "loam://docs/register-grammar" } },
      "alice-token",
    );
    const contents = (
      (await res.json()) as {
        result: { contents: Array<{ uri: string; mimeType?: string; text: string }> };
      }
    ).result.contents;
    expect(contents[0]!.uri).toBe("loam://docs/register-grammar");
    expect(contents[0]!.mimeType).toBe("text/markdown");
    expect(contents[0]!.text).toBe(await grammar());
  });

  it("an unknown resource is an error naming the real one, not an empty success", async () => {
    const res = await rpc(
      { method: "resources/read", params: { uri: "loam://docs/weeding" } },
      "alice-token",
    );
    const body = (await res.json()) as { result?: unknown; error?: { message: string } };
    expect(body.result).toBeUndefined();
    expect(body.error?.message).toContain("loam://docs/register-grammar");
  });
});

describe("(e) the instructions name the tool", () => {
  it("server/discover and initialize both say loam_docs, in the same words", async () => {
    const discover = await rpc({ method: "server/discover", params: {} }, "alice-token");
    const announced = ((await discover.json()) as { result: { instructions: string } }).result
      .instructions;
    expect(announced).toContain("loam_docs");

    const init = await rpc({ method: "initialize", params: {} }, "alice-token");
    const honoured = ((await init.json()) as { result: { instructions?: string } }).result
      .instructions;
    // The SAME string, not a second copy — two instruction texts would be free to drift, and a
    // client reads whichever method it spoke first.
    expect(honoured).toBe(announced);
  });
});

describe("(f) the anonymous door is unchanged", () => {
  it("without a bearer, loam_docs draws its siblings' refusal, byte for byte", async () => {
    // This leg is uniform by construction (the door gates before tool dispatch), so it was born
    // green; the WITH-bearer leg below is what reddened before the tool existed. Both stay,
    // because only the pair proves the tool arrived without opening an anonymous door.
    const docs = await rpc({ method: "tools/call", params: { name: "loam_docs", arguments: {} } });
    const sibling = await rpc({
      method: "tools/call",
      params: { name: "loam_query", arguments: { query: "{ __typename }" } },
    });
    expect(docs.status).toBe(401);
    expect(docs.status).toBe(sibling.status);
    expect(await docs.text()).toBe(await sibling.text());
  });

  it("with a bearer it answers — the tool exists behind the same door", async () => {
    const listing = await call("loam_docs", {});
    expect(listing.content[0]!.text.length).toBeGreaterThan(0);
  });
});

describe("the compiled source is docs/*.md, exactly", () => {
  it("the committed module regenerates byte-identically from docs/", () => {
    // The generator's own --check: the committed src/server/docs-content.ts is exactly what
    // docs/*.md compiles to. Exit 0 or this throws with the script's message.
    execFileSync(process.execPath, [join(root, "scripts", "build-docs.mjs"), "--check"], {
      cwd: root,
      encoding: "utf8",
    });
  });

  it("the door serves the docs file's own bytes — and the dropped tail stays dropped", async () => {
    const md = await grammar();
    expect(md).toBe(readFileSync(join(root, "docs", "register-grammar.md"), "utf8"));
    // T243 made the CLI say the bounce line; the compiled manual must not still carry it.
    expect(md).not.toMatch(/bounce/);
  });
});
