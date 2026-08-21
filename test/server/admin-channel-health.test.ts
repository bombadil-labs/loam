// T203 — channel health on /admin. §46.4 stores `lastSyncedAt` and `consecutiveFailures` on the
// channel record so a person can tell a QUIET peer from a FAILING one (H9). Until this rail, the
// only person-shaped reader was `loam federate list` in a shell on the store's own machine, and the
// admin page showed a channel's pool as a bare container row.
//
// What this file asserts, at both levels:
//   - delta level: the channel records in the ground carry the two fields, and a failed pull
//     increments the counter while leaving `lastSyncedAt` at 0;
//   - object level: the pages a PERSON reads — the dashboard panel, the pool's own page, and the
//     drop-confirm page of the container the channels receive into — render both fields, spell
//     `lastSyncedAt === 0` as words, and mark a failing channel distinctly.
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
import { MemoryBackend } from "../../src/store/memory.js";
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
  carol: "channel:ada:feed:carol",
  dave: "channel:ada:feed:dave",
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

/**
 * A store with two rooted users and three channels receiving into ONE child of ada's root.
 *
 * The fixture prerequisite this ticket names: `openChannel` declares a missing `into` container
 * with NO parent edge, so a bare `openChannel` would put every pool outside every user's subtree
 * and nothing would render. `ada:feed` is therefore declared as a child of `ada` FIRST.
 *
 * The three channels are the two-sided pair plus the convention case:
 *   - `alice` synced once and reached its peer — a real `lastSyncedAt`, no failures;
 *   - `carol` could not reach its peer — `lastSyncedAt` still 0, one consecutive failure;
 *   - `dave` was opened and never polled — `lastSyncedAt` 0 with NO failure, which is the pair
 *     "never synced" must not collapse into "failing".
 * bea's subtree holds no channel at all: the leakage side of the subtree contract.
 */
async function channelServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
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

  const reaches = { pull: (): Promise<never[]> => Promise.resolve([]) };
  const unreachable = {
    pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
  };
  const alice = await gateway.openChannel({ into: "ada:feed", prefix: "alice", source: reaches });
  await alice.sync();
  const carol = await gateway.openChannel({
    into: "ada:feed",
    prefix: "carol",
    source: unreachable,
  });
  // syncChannel records the failure and RETHROWS; the count is what this rail reads, so the throw
  // is caught here rather than left to fail the fixture.
  await expect(carol.sync()).rejects.toThrow(/did not answer/);
  await gateway.openChannel({ into: "ada:feed", prefix: "dave", source: reaches });

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
  return { base: handle.url, gateway };
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
  return end < 0 ? rest : rest.slice(0, end);
};

describe("T203 — channel health on /admin", () => {
  it("(a) the dashboard shows each subtree channel's lastSyncedAt and consecutiveFailures", async () => {
    const { base, gateway } = await channelServer();

    // Delta level: the records in the ground say it. The page below must agree with exactly this.
    const status = Object.fromEntries(gateway.channelStatus().map((c) => [c.name, c]));
    expect(status[POOL.alice]!.lastSyncedAt).toBeGreaterThan(0);
    expect(status[POOL.alice]!.consecutiveFailures).toBe(0);
    expect(status[POOL.carol]!.lastSyncedAt).toBe(0);
    expect(status[POOL.carol]!.consecutiveFailures).toBe(1);
    expect(status[POOL.dave]!.lastSyncedAt).toBe(0);
    expect(status[POOL.dave]!.consecutiveFailures).toBe(0);

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
    // whether bytes arrive and law binds. Both toggles are asserted TWO-SIDED — "not receiving"
    // contains "receiving", so a one-sided check reads the same on either setting.
    expect(failing).toContain("<code>carol</code>");
    expect(failing).toContain("receiving · blessing ·");
    expect(failing).not.toContain("not receiving");
    expect(failing).not.toContain("not blessing");

    // Each row links to the container the channel receives into, so a reader walks from the peer
    // to the surface it feeds.
    expect(synced).toContain(
      `<a href="/admin/container?name=ada%3Afeed"><code>ada:feed</code></a>`,
    );

    // The panel is a heading, one explanation, and a list — in that order, as real markup.
    const panel = panelOf(html);
    expect(panel).toMatch(/^<h2>Channels\.<\/h2>\n<p>[\s\S]+<\/p>\n<ul>\n<li>/);

    // Stable order: the rows sort by pool name, so a second reading puts each peer where the
    // first one did.
    expect(panel.indexOf(POOL.alice)).toBeLessThan(panel.indexOf(POOL.carol));
    expect(panel.indexOf(POOL.carol)).toBeLessThan(panel.indexOf(POOL.dave));
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
    expect(html).toContain("No channel receives into your subtree.");

    // Positive control: bea's own page rendered, so the assertions above are about missing channel
    // rows and not about a refusal page that happens to contain none of these words.
    expect(html).toContain("Your containers.");
    expect(html).toContain("<code>bea</code>");
  });
});
