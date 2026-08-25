// T218 — striking a receiving container ORPHANS its channels, and the orphans must be visible.
//
// Dropping (striking) a receiving container removes its declaration; the pool's `inboxOf` edge then
// dangles, `subtreeOf`'s fixpoint reaches nothing, and the dashboard renders its scope-honest empty
// state — while `channelStatus` still lists the channel `receiving: true` and any resumed sync keeps
// writing peer bytes to disk. The channels are ownerless: no reach-scoped panel shows them, no
// subtree reaches them, and they keep pulling. This rail makes that state VISIBLE.
//
// The block is for an OPERATOR, whose remit is store-wide — the orphans are outside every subtree by
// construction, and reach-scoping is the ordinary panel's contract. A non-operator's dashboard shows
// nothing, because nothing in their subtree is orphaned. That is the two-sidedness this file pins.
//
// What it asserts, at both levels:
//   - delta level: the strike really lands (the receiving container is gone from the table) while
//     the channel record survives, still `receiving: true`; a sibling receiving container that was
//     NOT struck is still in the table, so its channel is not orphaned;
//   - object level: the page a PERSON reads — the operator's dashboard names the orphaned channel,
//     its health (the T203 renderer), and the verbs that release it; it does NOT name the healthy
//     sibling channel in the orphan block; a non-operator's dashboard names none of it.
//
// The receiving container is struck through the REAL confirm flow (POST /admin/drop then
// /admin/drop-confirm), never by hand-appending a negation — a fixture that struck it any other way
// would prove the block against a state nothing in the product produces (T143).
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims, type UserRole } from "../../src/server/users.js";
import { SESSION_COOKIE } from "../../src/server/session.js";
import { containerClaims } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { SAME_ORIGIN, formTokenOf, signIn } from "../helpers/session-fixture.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SEEDS = { opal: "0a".repeat(32), nina: "17".repeat(32) } as const;
const KEYS = { opal: authorForSeed(SEEDS.opal), nina: authorForSeed(SEEDS.nina) } as const;

/** The pool names openChannel derives — `channel:<into>:<prefix>`. */
const POOL = {
  alice: "channel:opal:feed:alice", // receives into opal:feed (struck): orphaned, and failing
  zeb: "channel:opal:feed:zeb", // receives into opal:feed (struck): orphaned, and healthy
  carol: "channel:opal:live:carol", // receives into opal:live (survives): not orphaned
} as const;

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const reaches = { pull: (): Promise<never[]> => Promise.resolve([]) };
const unreachable = {
  pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
};

/**
 * opal (operator) and nina (actor), each with a root container, plus two receiving containers under
 * opal: `opal:feed` (to be struck) and `opal:live` (to survive).
 */
async function seedUsers(gateway: Gateway): Promise<void> {
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  const roles: Record<keyof typeof KEYS, UserRole> = { opal: "operator", nina: "actor" };
  for (const name of ["opal", "nina"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, roles[name], OPERATOR, ts++));
    await op(
      containerClaims(
        {
          container: name,
          trust: "curated",
          posture: "shared",
          membership: authoredBy(KEYS[name]),
        },
        OPERATOR,
        ts++,
      ),
    );
    await op(grantClaims(STORE_ENTITY, KEYS[name], "write", OPERATOR, ts++));
  }
  // openChannel declares a missing `into` with NO parent edge, which would put every pool outside
  // every subtree. So the two receiving containers are declared as children of opal FIRST — the
  // same fixture prerequisite T203 names.
  for (const child of ["opal:feed", "opal:live"] as const) {
    await op(
      containerClaims(
        {
          container: child,
          trust: "curated",
          posture: "shared",
          parent: "opal",
          membership: authoredBy(KEYS.opal),
        },
        OPERATOR,
        ts++,
      ),
    );
  }
}

/** A door over `gateway`, with opal and nina able to sign in. */
async function doorOver(gateway: Gateway): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "loam-t218-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { opal: hash, nina: hash } });
  writeUserSeed(home, "opal", SEEDS.opal);
  writeUserSeed(home, "nina", SEEDS.nina);
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

const textOf = async (base: string, session: string, path = "/admin"): Promise<string> =>
  (
    await fetch(`${base}${path}`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${session}` },
    })
  ).text();

const post = (
  base: string,
  path: string,
  session: string,
  fields: Record<string, string>,
): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams(fields).toString(),
  });

/**
 * The orphaned-channels panel of a page: its own heading and everything under it, up to the next
 * heading. Scoped rather than searched page-wide because a healthy channel's name appears in the
 * ORDINARY channels panel too — a bare page-wide `toContain` could not tell one panel from the
 * other, and the whole point of (a) is that the orphan sits in its own block.
 */
const orphanPanelOf = (html: string): string => {
  const marker = "<h2>Orphaned channels.</h2>";
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const rest = html.slice(at + marker.length);
  const next = rest.indexOf("<h2>");
  return next < 0 ? rest : rest.slice(0, next);
};

/**
 * A store where `opal:feed` receives a FAILING channel and `opal:live` receives a HEALTHY one, then
 * `opal:feed` is struck through the real confirm flow — so `channel:opal:feed:alice` is orphaned and
 * `channel:opal:live:carol` is not.
 */
async function orphanServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedUsers(gateway);

  // Two channels feed opal:feed, so striking it orphans BOTH — opened out of sorted order (zeb
  // before alice) so the panel's own `.sort()` is the only thing that can put alice first. alice
  // fails once, so the orphan row carries a real health reading (the T203 renderer's failure
  // marker), not a placeholder. carol feeds opal:live, which survives, so it stays a healthy,
  // un-orphaned control.
  await gateway.openChannel({ into: "opal:feed", prefix: "zeb", source: reaches });
  const alice = await gateway.openChannel({
    into: "opal:feed",
    prefix: "alice",
    source: unreachable,
  });
  await expect(alice.sync()).rejects.toThrow(/did not answer/);
  await gateway.openChannel({ into: "opal:live", prefix: "carol", source: reaches });

  const base = await doorOver(gateway);

  // STRIKE opal:feed through the real two-step drop, as opal (its owner). Step one renders the
  // confirm page and mints a single-use token; step two returns it and performs the strike.
  const opal = await signIn(base, "opal", PASSWORD);
  const token = formTokenOf(await textOf(base, opal));
  const confirm = await post(base, "/admin/drop", opal, { form_token: token, name: "opal:feed" });
  expect(confirm.status).toBe(200);
  const confirmToken = /name="confirm_token" value="([^"]+)"/.exec(await confirm.text())![1]!;
  const struck = await post(base, "/admin/drop-confirm", opal, {
    form_token: token,
    name: "opal:feed",
    confirm_token: confirmToken,
  });
  expect(struck.status).toBe(303);

  return { base, gateway };
}

describe("T218 — orphaned channels are visible to an operator", () => {
  it("(a) the operator's dashboard names the orphaned channel, its health, and its release verbs", async () => {
    const { base, gateway } = await orphanServer();

    // Delta level: the strike landed and the channel outlived it, still receiving. A sibling
    // receiving container that was not struck is still in the table, so its channel is NOT orphaned.
    const table = gateway.containers();
    expect(table.containers.has("opal:feed")).toBe(false);
    expect(table.containers.has("opal:live")).toBe(true);
    const status = Object.fromEntries(gateway.channelStatus().map((c) => [c.name, c]));
    expect(status[POOL.alice]!.into).toBe("opal:feed");
    expect(status[POOL.alice]!.receiving).toBe(true);
    expect(status[POOL.alice]!.consecutiveFailures).toBe(1);
    expect(status[POOL.carol]!.into).toBe("opal:live");

    // Object level: what opal reads. The orphan block names the channel, reuses the T203 health
    // renderer (the failure marker rides the row), and prints both release verbs.
    const opal = await signIn(base, "opal", PASSWORD);
    const panel = orphanPanelOf(await textOf(base, opal));
    expect(panel).toContain(POOL.alice);
    expect(panel).toContain("<strong>1 consecutive failure</strong>");
    expect(panel).toContain(`loam federate drop --channel ${POOL.alice} --yes`);
    expect(panel).toContain(`loam federate set --channel ${POOL.alice} --receiving false`);

    // The second channel into the struck container is orphaned too.
    expect(panel).toContain(POOL.zeb);

    // Stable order: the rows sort by pool name, so a second reading puts each where the first did.
    // The fixture opened them zeb, then alice, so alice precedes zeb ONLY if the panel sorts.
    expect(panel.indexOf(POOL.alice)).toBeLessThan(panel.indexOf(POOL.zeb));

    // Two-sided WITHIN the block: the healthy sibling channel, whose container still lives, is not
    // orphaned — so the block must not list it, even though it renders in the ordinary panel above.
    expect(panel).not.toContain(POOL.carol);
  });

  it("(b) a non-operator sees no orphan block, and the operator's block is why", async () => {
    const { base } = await orphanServer();

    // nina is an actor, not an operator: the orphans are outside her subtree by construction, so her
    // dashboard shows neither the block nor the ownerless channel.
    const nina = await signIn(base, "nina", PASSWORD);
    const ninaPage = await textOf(base, nina);
    expect(ninaPage).not.toContain("Orphaned channels.");
    expect(ninaPage).not.toContain(POOL.alice);
    // Positive control: nina's dashboard really rendered — the assertions above are about a missing
    // block, not about a refusal page that happens to contain none of these words.
    expect(ninaPage).toContain("Your containers.");
    expect(ninaPage).toContain("<code>nina</code>");

    // And the operator DOES see it: the two-sidedness is a difference in role, not an empty store.
    const opal = await signIn(base, "opal", PASSWORD);
    expect(await textOf(base, opal)).toContain("Orphaned channels.");
  });

  it("(c) an operator with no orphaned channel sees no block — absent, not empty", async () => {
    // A panel that is always present says nothing; the block appears only when a channel is actually
    // orphaned. Here opal is an operator with a LIVE channel and no struck container, so the block is
    // absent — even though the reader is an operator and the store has a channel.
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedUsers(gateway);
    await gateway.openChannel({ into: "opal:live", prefix: "carol", source: reaches });
    const base = await doorOver(gateway);

    const opal = await signIn(base, "opal", PASSWORD);
    const page = await textOf(base, opal);
    expect(page).not.toContain("Orphaned channels.");
    // Positive control: the reader is an operator and the ordinary channels panel DID render the
    // live channel — so the orphan block's absence means "nothing is orphaned", nothing else.
    expect(page).toContain("<h2>Channels.</h2>");
    expect(page).toContain(POOL.carol);
  });
});
