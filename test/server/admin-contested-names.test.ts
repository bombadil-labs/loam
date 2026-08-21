// T204 — the contested-names block on /admin. §47.1 promises that under a `conflicts` binding
// policy a contested name is "a stated refusal rather than a silent 404-shaped hole." Until this
// rail the statement was made only to code: the reading existed, and no surface read it, so a
// person met a lens that simply was not there.
//
// What this file asserts, at both levels:
//   - object level, the page a PERSON reads: the block names the withheld lens, and each contender
//     carries its origin, its signing author, its timestamp, and its binding delta id;
//   - the same page with nothing contested renders NO block at all (two-sided — a block that is
//     always present says nothing, and an empty one invites a reader to think the store is broken);
//   - the block matches `gateway.contestedNames()` row for row, field for field, and adds no row
//     the reading does not hold. The surface never disagrees with the resolver, and it never
//     re-derives the contest for itself (H10).
//
// The fixture's contest is CROSS-ORIGIN — a root registration against a channel pool's blessed
// one — on purpose. A root-vs-root contest gives every row the same origin, so a renderer that
// printed the word "root" on every line would satisfy any assertion drawn from it.
//
// Delta ids render as TEXT. No delta-addressed view exists to link to, so a link would go nowhere;
// the admin members list already renders delta ids this way.
//
// What it deliberately does NOT assert, and the rail that would close it: an unreadable TIMESTAMP.
// The renderer spells a non-finite stamp as words rather than letting `toISOString` throw the whole
// page down, and every timestamp a signed binding can carry through this path is a number, so the
// fixture cannot reach that branch through the product. The rail that would close it needs a
// planted binding delta with a non-numeric stamp.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims, type HyperSchema } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { bindingPolicyClaims } from "../../src/gateway/binding-policy.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { signIn } from "../helpers/session-fixture.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ADA_SEED = "aa".repeat(32);
const ADA = authorForSeed(ADA_SEED);

/** The pool `openChannel({ into: "ada:feed", prefix: "alice" })` derives. */
const POOL = "channel:ada:feed:alice";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const grounds: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (grounds.length > 0) await grounds.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

/** ada, and the container her channel receives into. */
async function seedAda(gateway: Gateway): Promise<void> {
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  await op(userClaims("ada", OPERATOR, ts++));
  await op(roleClaims("ada", "actor", OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "ada", trust: "curated", posture: "shared", membership: authoredBy(ADA) },
      OPERATOR,
      ts++,
    ),
  );
  // `openChannel` declares a missing `into` with no parent edge, which would put the pool outside
  // every user's subtree; declaring it as ada's child first keeps the fixture's store well formed.
  await op(
    containerClaims(
      {
        container: "ada:feed",
        trust: "curated",
        posture: "shared",
        parent: "ada",
        membership: authoredBy(ADA),
      },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts++));
}

async function doorOver(gateway: Gateway): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "loam-t204-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash } });
  writeUserSeed(home, "ada", ADA_SEED);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: { home, mount: "default" },
  });
  handles.push(handle);
  return handle.url;
}

const rival: HyperSchema = { name: "Rival", alg: 1, body: PLANT.body };

/**
 * A store whose `alice:Plant` is contested across origins.
 *
 * alice publishes `Plant`; the channel blesses it into the pool as `alice:Plant`; this store then
 * registers a definition of its OWN under that same living name. With `conflicts` declared, the
 * fold serves neither — which is precisely the hole the block fills.
 */
async function contestedServer(): Promise<{ base: string; gateway: Gateway }> {
  const alice = await Gateway.open(new MemoryBackend(), { seed: ALICE_SEED });
  grounds.push(alice);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedAda(gateway);
  await gateway.append([
    signClaims(bindingPolicyClaims("conflicts", OPERATOR, gateway.nextTimestamp()), OPERATOR_SEED),
  ]);
  const channel = await gateway.openChannel({
    into: "ada:feed",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  await channel.sync();
  await gateway.publishRegistration(
    rival,
    { ...PLANT_POLICY, name: "alice:Plant" },
    [FERN],
    undefined,
    "hyperschema:Rival",
  );
  return { base: await doorOver(gateway), gateway };
}

/** The same store, minus the rival: a lens that serves, and nothing withheld. */
async function calmServer(): Promise<{ base: string; gateway: Gateway }> {
  const alice = await Gateway.open(new MemoryBackend(), { seed: ALICE_SEED });
  grounds.push(alice);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedAda(gateway);
  await gateway.append([
    signClaims(bindingPolicyClaims("conflicts", OPERATOR, gateway.nextTimestamp()), OPERATOR_SEED),
  ]);
  const channel = await gateway.openChannel({
    into: "ada:feed",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  await channel.sync();
  return { base: await doorOver(gateway), gateway };
}

const textOf = async (base: string, session: string): Promise<string> =>
  (
    await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    })
  ).text();

/**
 * The contested-names block: its own section, and nothing outside it.
 *
 * Scoped to the section rather than searched page-wide because the same lens name appears in the
 * schema panel and the container tree — a bare `toContain` over the page would pass on a store
 * that renders no refusal at all.
 */
const panelOf = (html: string): string => {
  const at = html.indexOf(`<section class="contested">`);
  if (at < 0) return "";
  const rest = html.slice(at);
  const end = rest.indexOf("</section>");
  // A section that never closes is not a block: it would swallow the rest of the page.
  return end < 0 ? "" : rest.slice(0, end);
};

/**
 * ONE contender's row, found by the binding delta id that identifies it.
 *
 * A contender is the innermost list item, so the nearest `<li` before the id opens its own row. A
 * value printed as loose text — not inside a row — returns "" and fails, which is what stops a
 * page that prints the fields in a paragraph from being scored as the block this rail asks for.
 */
const rowFor = (html: string, deltaId: string): string => {
  const panel = panelOf(html);
  const at = panel.indexOf(deltaId);
  if (at < 0) return "";
  const from = panel.lastIndexOf("<li", at);
  if (from < 0) return "";
  const rest = panel.slice(from);
  const end = rest.indexOf("</li>");
  return end < 0 ? "" : rest.slice(0, end);
};

describe("T204 — contested names on /admin", () => {
  it("(c) the block names the withheld lens and every contender's origin, author, and timestamp", async () => {
    const { base, gateway } = await contestedServer();
    grounds.push(gateway);

    // The store really is withholding the name — the page below must agree with exactly this.
    expect(() => gateway.def("alice:Plant")).toThrow();
    const reading = gateway.contestedNames();
    expect([...reading.keys()]).toEqual(["alice:Plant"]);
    const rows = reading.get("alice:Plant")!;
    expect(rows.map((r) => r.origin).sort()).toEqual([POOL, "root"]);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    const panel = panelOf(html);
    expect(panel).toContain("<strong>alice:Plant</strong>");
    expect(panel).toContain(POOL);
    expect(panel).toContain("root");
    expect(panel).toContain("hyperschema:Rival");

    for (const row of rows) {
      const rendered = rowFor(html, row.deltaId);
      expect(rendered, `no row for ${row.origin}`).not.toBe("");
      expect(rendered).toContain(row.origin);
      expect(rendered).toContain(row.author);
      expect(rendered).toContain(new Date(row.timestamp).toISOString());
    }
  });

  it("(c) a store withholding nothing renders no block at all", async () => {
    const { base, gateway } = await calmServer();
    grounds.push(gateway);

    // Two-sided: the channel's lens SERVES here, so the absence below is "nothing is contested"
    // and not "this store has no lenses".
    expect(gateway.def("alice:Plant")).toBeDefined();
    expect(gateway.contestedNames().size).toBe(0);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    expect(panelOf(html)).toBe("");
    expect(html).not.toContain("Contested names.");
    // The page still renders: a missing block is not a broken dashboard.
    expect(html).toContain("<h2>Schemas.</h2>");
  });

  it("(d) the block matches the gateway reading, row for row, and invents no row", async () => {
    const { base, gateway } = await contestedServer();
    grounds.push(gateway);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    const panel = panelOf(html);
    const reading = gateway.contestedNames();
    // Non-vacuous: an empty reading would satisfy every loop below.
    expect(reading.size).toBe(1);

    let contenders = 0;
    for (const [lens, rows] of reading) {
      expect(panel).toContain(`<strong>${lens}</strong>`);
      expect(rows.length).toBeGreaterThan(1);
      for (const row of rows) {
        contenders += 1;
        const rendered = rowFor(html, row.deltaId);
        expect(rendered).toContain(row.entity);
        expect(rendered).toContain(row.origin);
        expect(rendered).toContain(row.author);
        expect(rendered).toContain(new Date(row.timestamp).toISOString());
        expect(rendered).toContain(row.deltaId);
      }
    }
    // ...and NOTHING ELSE. One list item per contender, plus one per withheld name: a surface that
    // added a row of its own — a stale contest, a name the resolver does not withhold — would pass
    // every assertion above and fail this one.
    expect(panel.split("<li").length - 1).toBe(contenders + reading.size);
  });
});
