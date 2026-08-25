// T217 — the /admin channels panel reads its "unreadable" verdict FROM THE READER, and names the
// field it cannot read.
//
// The panel already refused to render a NaN time (T203). It reached that verdict by sniffing the
// two numbers itself — `Number.isFinite(lastSyncedAt) && Number.isFinite(consecutiveFailures)` —
// and that guard cannot see the case this rail is about: a record MISSING a health field coerces to
// a finite 0, so the panel drew "never synced", which is exactly what a real quiet peer draws. The
// verdict belongs at `readChannels`, where the record's own shapes are known.
//
// What this file asserts, at both levels:
//   - delta level: the truncated record really is the newest one in the ground, and the reader
//     really does mark it — so the page below is being read against a known store rather than
//     against itself;
//   - object level: the row a PERSON reads, server-rendered through the real door and a real
//     session.
//
// TWO-SIDED: a legible channel in the same panel still renders its real health. A panel that
// shouted "unreadable" on every row would satisfy the first half alone.
//
// What it deliberately does NOT assert:
//   - the NaN rows, the sort order, the subtree fence, and the drop-confirm page — all owned by
//     the frozen `admin-channel-health.test.ts`, which must keep passing untouched;
//   - the reader's own marker, which is `test/federation/channel-record-trust.test.ts`.
//
// Erasure standing rule: every store here is this file's own MemoryBackend or mkdtemp fixture.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Claims } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { channelRecordClaims } from "../../src/federation/channel.js";
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

const OPERATOR_SEED = "2c".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "a7".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";

const ALICE = "channel:ada:feed:alice";
const BRAM = "channel:ada:feed:bram";

const homes: string[] = [];
const handles: ServerHandle[] = [];
const grounds: Gateway[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (grounds.length > 0) await grounds.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const nothing = { pull: (): Promise<never[]> => Promise.resolve([]) };

/**
 * ada, and `ada:feed` — the receiving container, declared as a CHILD of ada's root.
 *
 * `openChannel` declares a missing `into` with no parent edge, so a bare open would put every pool
 * outside every subtree and the panel would render nothing at all.
 */
async function channelServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  grounds.push(gateway);
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  const authoredByAda = {
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: ADA } },
    in: "input",
  };
  await op(userClaims("ada", OPERATOR, ts++));
  await op(roleClaims("ada", "actor", OPERATOR, ts++));
  await op(
    containerClaims(
      { container: "ada", trust: "curated", posture: "shared", membership: authoredByAda },
      OPERATOR,
      ts++,
    ),
  );
  await op(
    containerClaims(
      {
        container: "ada:feed",
        trust: "curated",
        posture: "shared",
        parent: "ada",
        membership: authoredByAda,
      },
      OPERATOR,
      ts++,
    ),
  );
  await op(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts++));

  const alice = await gateway.openChannel({ into: "ada:feed", prefix: "alice", source: nothing });
  await alice.sync();
  await gateway.openChannel({ into: "ada:feed", prefix: "bram", source: nothing });

  // bram's record, MINUS its `lastSyncedAt` pointer. Built by the product's own claims function so
  // the reader meets the shape the product writes; only the truncation is the fixture's doing.
  const built = channelRecordClaims(
    gateway.channelStatus(BRAM)[0]!,
    OPERATOR,
    gateway.nextTimestamp(),
  );
  await gateway.append([
    signClaims(
      { ...built, pointers: built.pointers.filter((p) => p.role !== "lastSyncedAt") },
      OPERATOR_SEED,
    ),
  ]);

  const home = mkdtempSync(join(tmpdir(), "loam-t217-admin-"));
  homes.push(home);
  writeCredentials(home, { version: 1, users: { ada: await hashPassword(PASSWORD, CHEAP) } });
  writeUserSeed(home, "ada", ADA_SEED);
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

/** The channels panel of a page: its heading, and its own list — nothing after it. */
const panelOf = (html: string): string => {
  const at = html.indexOf("<h2>Channels.</h2>");
  if (at < 0) return "";
  const rest = html.slice(at);
  const list = rest.indexOf("</ul>");
  const next = rest.indexOf("<h2>", 1);
  const end = list < 0 || (next >= 0 && next < list) ? next : list;
  return end < 0 ? rest : rest.slice(0, end);
};

/** ONE channel's own row inside the panel — scoped, so a name elsewhere on the page cannot score. */
const rowFor = (html: string, pool: string): string => {
  const panel = panelOf(html);
  const at = panel.indexOf(pool);
  if (at < 0) return "";
  const from = panel.lastIndexOf("<li", at);
  if (from < 0) return "";
  const rest = panel.slice(from);
  const end = rest.indexOf("</li>");
  return end < 0 ? "" : rest.slice(0, end);
};

describe("T217 — the channels panel will not guess at a record it cannot read", () => {
  it("a record missing a health field renders UNREADABLE and names the field", async () => {
    const { base, gateway } = await channelServer();

    // Delta level: the reader marks it, and the coercion the OLD panel guard read is a perfectly
    // finite 0 — which is why that guard could not see this record and this rail is not hollow.
    const bad = gateway.channelStatus(BRAM)[0]!;
    expect(bad.unreadable).toContain("lastSyncedAt");
    expect(Number.isFinite(bad.lastSyncedAt)).toBe(true);
    expect(bad.lastSyncedAt).toBe(0);

    // Object level: what ada reads.
    const ada = await signIn(base, "ada", PASSWORD);
    const res = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${ada}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    const row = rowFor(html, BRAM);
    expect(row).not.toBe("");
    // STRUCTURAL, not a colour: the panel's own convention is that a marker survives a
    // stylesheet-less read, so the tag is part of what this row promises.
    expect(row).toContain("<strong>unreadable");
    // It NAMES the field, which is the half only the reader's marker can supply.
    expect(row).toContain("lastSyncedAt");
    // And it says nothing about a health it cannot read. "never synced" is the exact false report
    // this record used to draw.
    expect(row).not.toContain("never synced");
    expect(row).not.toContain("consecutive failure");
    expect(row).not.toContain("NaN");
    expect(row).not.toContain("Invalid Date");

    // NOR DOES IT DRAW THE RECORD'S OTHER COERCED IDENTITIES. The row's opening half normally
    // renders the prefix and a link to the receiving container, both read from primitives that may
    // themselves be condemned — an absent `into` renders a link to no container at all. Only the
    // channel's NAME is read from the marker's entity id, so it is the one identity always legible
    // and the only one this row is entitled to show.
    expect(row).toContain(BRAM);
    expect(row).not.toContain("the peer you call");
    expect(row).not.toContain("/admin/container?name=ada%3Afeed");

    // TWO-SIDED: the legible channel in the same panel still renders its real health.
    const good = rowFor(html, ALICE);
    expect(good).not.toBe("");
    expect(good).not.toContain("unreadable");
    expect(good).toContain("receiving");
    expect(good).toContain("0 consecutive failures");
    expect(good).toContain(new Date(gateway.channelStatus(ALICE)[0]!.lastSyncedAt).toISOString());
  });
});
