// T203 — channel health on /admin. §46.4 stores `lastSyncedAt` and `consecutiveFailures` on the
// channel record so a person can tell a QUIET peer from a FAILING one (H9). Until this rail, the
// only person-shaped reader was `loam federate list` in a shell on the store's own machine, and the
// admin page showed a channel's pool as a bare container row.
//
// What this file asserts, at both levels:
//   - delta level: the channel records in the ground carry the two fields, a failed pull
//     increments the counter while leaving `lastSyncedAt` at 0, and a rebooted store really does
//     leave an unresumed channel out of `federationChannels`;
//   - object level: the pages a PERSON reads — the dashboard panel, the pool's own page, and the
//     drop-confirm page of the container the channels receive into — render both fields, spell
//     `lastSyncedAt === 0` as words, mark a failing channel distinctly, and refuse to report
//     health for a channel nothing is polling or whose record does not read as numbers.
//
// THE PANEL MUST NOT REPORT HEALTH IT CANNOT KNOW (H7/H9), which is what (e) and (f) pin. A
// channel left unresumed at boot has a failure count that can NEVER increment, so rendering it
// from the record alone says "0 failures" about a peer this store stopped calling. A record whose
// numbers are strings reads back NaN, and one of those used to take every admin page down with it.
//
// What it deliberately does NOT assert, and the gap it names:
//   - THE POOL'S OWN DROP-CONFIRM PAGE IS UNREACHABLE TODAY. `POST /admin/drop` on a channel pool
//     refuses 409 — the door's drop plan reaches `gw.connectionInboxes` only, and a channel pool
//     lives in `gw.channelPools` — so `loam_federate_drop`'s `confirmAt` link lands on the pool's
//     container page and the drop offered there cannot complete. This file rails that page (where
//     the drop button is) and the receiving container's confirm page. The rail that would close
//     the gap is a drop-confirm assertion on the pool itself, and it needs the door's drop plan to
//     reach channel pools first — a widening of what this page can purge, which is not this
//     ticket's to decide.
//   - Sever behaviour itself (the purge, and a bystander channel's survival) — the §46 rails own it.
//   - The connections panel's own rows — `admin-connections.test.ts`.
//
// Erasure standing rule: every store here is this file's own memory/mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { channelRecordClaims, type ChannelStatus } from "../../src/federation/channel.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
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
const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32) } as const;
const KEYS = { ada: authorForSeed(SEEDS.ada), bea: authorForSeed(SEEDS.bea) } as const;

/** The pool names openChannel derives — `channel:<into>:<prefix>`. */
const POOL = {
  alice: "channel:ada:feed:alice",
  bram: "channel:ada:feed:bram",
  carol: "channel:ada:feed:carol",
  dave: "channel:ada:feed:dave",
  erin: "channel:ada:feed:erin",
  fred: "channel:ada:feed:fred",
} as const;

const authoredBy = (key: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: key } },
  in: "input",
});

const homes: string[] = [];
const handles: ServerHandle[] = [];
const grounds: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  // A sqlite-backed ground holds file handles the temp-dir removal below needs released first.
  while (grounds.length > 0) await grounds.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const reaches = { pull: (): Promise<never[]> => Promise.resolve([]) };
const unreachable = {
  pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
};

/** ada, bea, and `ada:feed` — the receiving container, declared INSIDE ada's subtree. */
async function seedUsers(gateway: Gateway): Promise<void> {
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const name of ["ada", "bea"] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
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
  }
  // The fixture prerequisite this ticket names: `openChannel` declares a missing `into` container
  // with NO parent edge, so a bare `openChannel` would put every pool outside every user's subtree
  // and nothing would render. `ada:feed` is therefore declared as a child of `ada` FIRST.
  await op(
    containerClaims(
      {
        container: "ada:feed",
        trust: "curated",
        posture: "shared",
        parent: "ada",
        membership: authoredBy(KEYS.ada),
      },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, KEYS.ada, "write", OPERATOR, ts++));
}

/** A door over `gateway`, with ada and bea able to sign in. */
async function doorOver(gateway: Gateway): Promise<string> {
  const home = mkdtempSync(join(tmpdir(), "loam-t203-"));
  homes.push(home);
  const hash = await hashPassword(PASSWORD, CHEAP);
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash } });
  writeUserSeed(home, "ada", SEEDS.ada);
  writeUserSeed(home, "bea", SEEDS.bea);
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

/**
 * Six channels receiving into one child of ada's root, one per state the panel must tell apart.
 *
 *   | peer  | last sync | failures | toggles              | what it proves                     |
 *   |-------|-----------|----------|----------------------|------------------------------------|
 *   | alice | a real ms | 0        | receiving, blessing  | a healthy row, and a real time     |
 *   | bram  | never     | 0        | NOT receiving        | the receiving toggle, positively   |
 *   | carol | never     | 1        | receiving, blessing  | the failure marker                 |
 *   | dave  | never     | 0        | NOT blessing         | the blessing toggle, positively    |
 *   | erin  | garbage   | 0        | —                    | a bad TIME cannot 500 the page     |
 *   | fred  | never     | garbage  | —                    | a bad COUNT is not rendered as NaN |
 *
 * Both toggles are flipped THROUGH `setChannel`, the same path `loam federate set` drives — a
 * hand-written record would prove the renderer against a shape nothing in the product writes.
 *
 * ONE corrupt field each, never both. A fixture that corrupts both fields of one record cannot
 * tell an `||` guard from an `&&` guard, and the `&&` version lets a half-corrupt record through
 * to the throw.
 *
 * OPENED OUT OF ALPHABETICAL ORDER on purpose. `readChannels` yields channels in first-append
 * order, so a fixture opened a→f would render sorted with the panel's `.sort()` DELETED, and the
 * order rail would pass on a panel that does not sort.
 *
 * bea's subtree holds no channel at all: the leakage side of the subtree contract.
 */
async function channelServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedUsers(gateway);

  const open = (
    prefix: string,
    source: typeof reaches,
  ): Promise<{ sync: () => Promise<unknown> }> =>
    gateway.openChannel({ into: "ada:feed", prefix, source });

  await open("dave", reaches);
  await open("fred", reaches);
  const alice = await open("alice", reaches);
  await alice.sync();
  await open("erin", reaches);
  const carol = await open("carol", unreachable);
  // syncChannel records the failure and RETHROWS; the count is what this rail reads, so the throw
  // is caught here rather than left to fail the fixture.
  await expect(carol.sync()).rejects.toThrow(/did not answer/);
  await open("bram", reaches);

  await gateway.setChannel(POOL.bram, { receiving: false });
  await gateway.setChannel(POOL.dave, { blessing: false });

  // Channel records whose health fields are not numbers. `readChannels` coerces with `Number(...)`
  // and filters by no author, so any writer can put NaN in front of the renderer; one such record
  // must cost its own row and nothing else. ONE bad field each — erin's time, fred's count — so
  // the renderer's guard is proved on each field separately.
  // The claims are built by the PRODUCT's own `channelRecordClaims`, so the delta shape is exactly
  // what `readChannels` parses — a hand-rolled delta would prove the guard against a shape nothing
  // writes. Only the field's TYPE is forced, which is the whole point of the rail.
  const corrupt = (pool: string, field: Partial<ChannelStatus>): Promise<unknown> =>
    gateway.append([
      signClaims(
        channelRecordClaims(
          { ...gateway.channelStatus(pool)[0]!, ...field },
          OPERATOR,
          gateway.nextTimestamp(),
        ),
        OPERATOR_SEED,
      ),
    ]);
  await corrupt(POOL.erin, { lastSyncedAt: "soon" as unknown as number });
  await corrupt(POOL.fred, { consecutiveFailures: "a few" as unknown as number });

  return { base: await doorOver(gateway), gateway };
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
 * The channels panel of a page: its heading, and its own list — nothing after it.
 *
 * Closed at its own `</ul>` rather than at the next heading, because a container page renders its
 * member deltas between the two, and a channel record read as a member would otherwise be scored
 * as a health row.
 */
const panelOf = (html: string): string => {
  const at = html.indexOf("<h2>Channels.</h2>");
  if (at < 0) return "";
  const rest = html.slice(at);
  const list = rest.indexOf("</ul>");
  const next = rest.indexOf("<h2>", 1);
  const end = list < 0 || (next >= 0 && next < list) ? next : list;
  return end < 0 ? rest : rest.slice(0, end);
};

/**
 * ONE channel's own row inside the panel.
 *
 * Scoped rather than searched page-wide on purpose: a pool's name also appears in the container
 * tree, in the connections panel, and in the declare form's parent list, so a bare `toContain`
 * over the whole page would pass on markup that renders no health at all — and a marker printed
 * on a SIBLING row would satisfy it too.
 *
 * A name that is not inside a list item is NOT a row: health rendered as loose text on the page
 * is not the panel this rail asks for, and returning "" here is what makes that fail.
 */
const rowFor = (html: string, pool: string): string => {
  const panel = panelOf(html);
  const at = panel.indexOf(pool);
  if (at < 0) return "";
  const from = panel.lastIndexOf("<li", at);
  if (from < 0) return "";
  const rest = panel.slice(from);
  const end = rest.indexOf("</li>");
  // A row that never closes is not a row either: the list item it belongs to would swallow every
  // row after it, so an unclosed one is markup this rail refuses to score.
  if (end < 0) return "";
  return rest.slice(0, end);
};

describe("T203 — channel health on /admin", () => {
  it("(a) the dashboard shows each subtree channel's lastSyncedAt and consecutiveFailures", async () => {
    const { base, gateway } = await channelServer();

    // Delta level: the records in the ground say it. The page below must agree with exactly this.
    const status = Object.fromEntries(gateway.channelStatus().map((c) => [c.name, c]));
    // A hand-written wall-clock floor (2025-08-12), not a value read back from the same source the
    // page renders: a stamp of 1 would satisfy `> 0` while proving the clock was never consulted.
    expect(status[POOL.alice]!.lastSyncedAt).toBeGreaterThan(1755000000000);
    expect(status[POOL.alice]!.consecutiveFailures).toBe(0);
    expect(status[POOL.carol]!.lastSyncedAt).toBe(0);
    expect(status[POOL.carol]!.consecutiveFailures).toBe(1);
    expect(status[POOL.dave]!.lastSyncedAt).toBe(0);
    expect(status[POOL.dave]!.consecutiveFailures).toBe(0);
    expect(status[POOL.bram]!.receiving).toBe(false);
    expect(status[POOL.dave]!.blessing).toBe(false);

    // Object level: what ada reads, server-rendered.
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await textOf(base, ada);

    const synced = rowFor(html, POOL.alice);
    expect(synced).toContain(new Date(status[POOL.alice]!.lastSyncedAt).toISOString());
    expect(synced).toContain("0 consecutive failures");

    // `lastSyncedAt === 0` is NEVER SYNCED and renders as words — the loam_federate_status
    // convention. A bare zero, or a 1970 timestamp, would read as "synced a while ago".
    const failing = rowFor(html, POOL.carol);
    expect(failing).toContain("never synced");
    expect(failing).not.toMatch(/1970/);
    expect(failing).toContain("1 consecutive failure");

    const quiet = rowFor(html, POOL.dave);
    expect(quiet).toContain("never synced");
    expect(quiet).toContain("0 consecutive failures");

    // The prefix and the two toggles ride the same row: the receiver's own name for the peer, and
    // whether bytes arrive and law binds. Each toggle is proved from BOTH settings by a channel
    // that actually holds it — "not receiving" contains "receiving", so a panel that hardcoded the
    // healthy words would satisfy any assertion drawn from healthy rows alone.
    expect(failing).toContain("<code>carol</code>");
    expect(failing).toContain("receiving · blessing ·");
    expect(failing).not.toContain("not receiving");
    expect(failing).not.toContain("not blessing");
    expect(rowFor(html, POOL.bram)).toContain("not receiving");
    expect(rowFor(html, POOL.dave)).toContain("not blessing");

    // Each row links BOTH ways — to the pool, which is where the sever lives, and to the container
    // the channel feeds — so a reader walks from the peer to either surface.
    expect(synced).toContain(
      `<a href="/admin/container?name=${encodeURIComponent(POOL.alice)}">` +
        `<code>${POOL.alice}</code></a>`,
    );
    expect(synced).toContain(
      `<a href="/admin/container?name=ada%3Afeed"><code>ada:feed</code></a>`,
    );

    // The panel is a heading, one explanation, and a list — in that order, as real markup.
    const panel = panelOf(html);
    expect(panel).toMatch(/^<h2>Channels\.<\/h2>\n<p>[\s\S]+<\/p>\n<ul>\n<li>/);

    // Stable order: the rows sort by pool name, so a second reading puts each peer where the first
    // one did. The fixture opened them dave, alice, erin, carol, bram, so this ordering exists
    // only if the panel sorts.
    const order = [POOL.alice, POOL.bram, POOL.carol, POOL.dave, POOL.erin].map((p) =>
      panel.indexOf(p),
    );
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(order.every((i) => i > 0)).toBe(true);
  });

  it("(b) a failing channel is marked and a healthy one is not", async () => {
    const { base } = await channelServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const html = await textOf(base, ada);

    // The marker is structural, not a colour: `<strong>` reads distinctly with no stylesheet and
    // survives a text browser.
    expect(rowFor(html, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");

    // Two-sided, and the half that matters: a channel that has NOT failed carries no marker.
    // Without this the panel could shout on every row and still pass the assertion above.
    expect(rowFor(html, POOL.alice)).not.toContain("<strong>");
    expect(rowFor(html, POOL.dave)).not.toContain("<strong>");
  });

  it("(c) the sever surface shows the health of what it would sever", async () => {
    const { base, gateway } = await channelServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const at = new Date(gateway.channelStatus(POOL.alice)[0]!.lastSyncedAt).toISOString();

    // The page `loam_federate_drop` stages its confirmAt link at, and the page the drop button
    // lives on: the pool's own container page.
    const pool = await textOf(base, ada, `/admin/container?name=${encodeURIComponent(POOL.carol)}`);
    expect(rowFor(pool, POOL.carol)).toContain("never synced");
    expect(rowFor(pool, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    // It is the sever surface, so the drop offer must be on the same page as the health.
    expect(pool).toContain(`action="/admin/drop"`);
    // And the panel sits directly under the container's own state line, above everything the page
    // offers to do to it.
    expect(pool).toContain("</p>\n<h2>Channels.</h2>");
    // Scoped to this pool: another channel's health does not ride a page about this one.
    expect(rowFor(pool, POOL.alice)).toBe("");

    // And the drop-confirm page of the container these channels receive into: dropping it ends
    // what every channel below it feeds, so it names each one's health above the confirm button.
    const token = formTokenOf(await textOf(base, ada));
    const res = await post(base, "/admin/drop", ada, { form_token: token, name: "ada:feed" });
    expect(res.status).toBe(200);
    const confirm = await res.text();
    expect(confirm).toContain("confirm_token");
    expect(rowFor(confirm, POOL.alice)).toContain(at);
    expect(rowFor(confirm, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    expect(rowFor(confirm, POOL.dave)).toContain("never synced");
    // Health sits ABOVE the confirm button: a person reads it before deciding, not after.
    expect(confirm.indexOf("never synced")).toBeLessThan(confirm.indexOf("yes — drop it"));

    // AND IT SAYS WHAT THE DROP DOES NOT DO. This drop strikes a declaration; every pool below it
    // is untouched and every sync goes on running. A health list above a confirm button, with no
    // such sentence, reads as the list of things about to be severed.
    expect(confirm).toContain("This drop does not sever these channels.");
    expect(confirm.indexOf("does not sever these channels")).toBeLessThan(
      confirm.indexOf("yes — drop it"),
    );
  });

  it("(d) a user whose subtree holds no channel sees no health rows", async () => {
    const { base } = await channelServer();
    const bea = await signIn(base, "bea", PASSWORD);
    const html = await textOf(base, bea);

    // Every channel on this store receives into ada's subtree, so bea's page names none of them
    // and reports the absence rather than rendering an empty panel that reads like a broken one.
    for (const pool of Object.values(POOL)) expect(html).not.toContain(pool);
    expect(html).not.toContain("never synced");
    expect(html).not.toContain("consecutive failure");

    // Scope-honest wording. Five channels are receiving on this store right now, so a page that
    // says "no channel receives" states something false; what is true is that none of them
    // receives anywhere bea can see.
    // As a real paragraph inside the panel, not loose text where its tags used to be.
    expect(panelOf(html)).toContain(
      "<p>No channel receives into a container your subtree reaches.</p>",
    );
    expect(html).not.toContain("No channel receives into your subtree.");

    // Positive control: bea's own page rendered, so the assertions above are about missing channel
    // rows and not about a refusal page that happens to contain none of these words.
    expect(html).toContain("Your containers.");
    expect(html).toContain("<code>bea</code>");
  });

  it("(e) a corrupt channel record costs its own row and no more", async () => {
    const { base, gateway } = await channelServer();

    // Delta level: each record really does read back as NaN in ONE field, and its sibling field is
    // still a good number. erin's is the time `new Date(...).toISOString()` throws on; fred's is
    // the count that would otherwise be printed at a person as the word NaN.
    const erin = gateway.channelStatus(POOL.erin)[0]!;
    const fred = gateway.channelStatus(POOL.fred)[0]!;
    expect(Number.isNaN(erin.lastSyncedAt)).toBe(true);
    expect(Number.isFinite(erin.consecutiveFailures)).toBe(true);
    expect(Number.isNaN(fred.consecutiveFailures)).toBe(true);
    expect(Number.isFinite(fred.lastSyncedAt)).toBe(true);

    const ada = await signIn(base, "ada", PASSWORD);
    const res = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${ada}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    // Each bad row names itself as unreadable rather than inventing a time or a count. Both are
    // asserted, so a guard that demanded BOTH fields be corrupt would let one of them through.
    for (const pool of [POOL.erin, POOL.fred]) {
      const bad = rowFor(html, pool);
      expect(bad).toContain("unreadable");
      expect(bad).not.toContain("never synced");
      expect(bad).not.toContain("consecutive failure");
      expect(bad).not.toContain("NaN");
      expect(bad).not.toContain("Invalid Date");
    }

    // Two-sided, and the point of the rail: every other channel still renders its real health.
    expect(rowFor(html, POOL.alice)).toContain("0 consecutive failures");
    expect(rowFor(html, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    expect(rowFor(html, POOL.bram)).toContain("not receiving");
  });

  it("(f) a channel this store did not resume says so, and never reads as healthy", async () => {
    // A store that boots without the peer's token leaves the channel OUT of `federationChannels`
    // (gateway.ts, resumeChannels): its pool attaches, nothing polls it, and its failure count can
    // therefore never move. Rendered from the record alone it reads "receiving · 0 consecutive
    // failures" — a false report of health about a peer this store stopped talking to.
    const home = mkdtempSync(join(tmpdir(), "loam-t203-boot-"));
    homes.push(home);
    const genesis = assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] });
    const backendFor = (pool: string): SqliteBackend =>
      new SqliteBackend(join(home, `${pool.replace(/[^A-Za-z0-9._-]/g, "_")}.sqlite`));
    const store = (): SqliteBackend => new SqliteBackend(join(home, "store.sqlite"));

    const first = await Gateway.boot(store(), genesis, { channelBackend: backendFor });
    await seedUsers(first);
    // `from` is recorded, so the only thing missing after the reboot is the credential.
    const alice = await first.openChannel({
      into: "ada:feed",
      prefix: "alice",
      from: "https://peer.example/default",
      source: reaches,
    });
    await alice.sync();
    await first.close();

    // Reboot WITHOUT channelToken: resumeChannels attaches the pool and skips the rebuild.
    const rebooted = await Gateway.boot(store(), genesis, { channelBackend: backendFor });
    grounds.push(rebooted);
    expect(rebooted.channelStatus(POOL.alice)).toHaveLength(1);
    expect(rebooted.federationChannels.has(POOL.alice)).toBe(false);
    const syncedAt = new Date(rebooted.channelStatus(POOL.alice)[0]!.lastSyncedAt).toISOString();

    const base = await doorOver(rebooted);
    const ada = await signIn(base, "ada", PASSWORD);
    const row = rowFor(await textOf(base, ada), POOL.alice);

    expect(row).toContain("not resumed");
    expect(row).toContain("this store is not polling this peer");
    // The three words that would make it read healthy. "receiving" is checked as a whole word so
    // the assertion cannot be satisfied by the absence of a substring it never contained.
    expect(row).not.toMatch(/\breceiving\b/);
    expect(row).not.toContain("consecutive failure");
    // The last sync is a true fact and stays: what is false is the health, not the history.
    expect(row).toContain(syncedAt);
    // Marked, like every other row the reader must not skim past.
    expect(row).toContain("<strong>");

    // The caption teaches the difference, so a reader is not left to guess what "not resumed" is.
    expect(panelOf(await textOf(base, ada))).toContain("not resumed");
  });
});
