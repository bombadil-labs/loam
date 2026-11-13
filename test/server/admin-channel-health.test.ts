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
import { containerClaims } from "../../src/gateway/container-law.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { SAME_ORIGIN, formTokenOf, signIn } from "../helpers/session-fixture.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SEEDS = { ada: "aa".repeat(32), bea: "bb".repeat(32) } as const;
const KEYS = { ada: authorForSeed(SEEDS.ada), bea: authorForSeed(SEEDS.bea) } as const;

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
  while (grounds.length > 0) await grounds.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

const reaches = { pull: (): Promise<never[]> => Promise.resolve([]) };
const unreachable = {
  pull: (): Promise<never[]> => Promise.reject(new Error("the peer did not answer")),
};

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
  await expect(carol.sync()).rejects.toThrow(/did not answer/);
  await open("bram", reaches);

  await gateway.setChannel(POOL.bram, { receiving: false });
  await gateway.setChannel(POOL.dave, { blessing: false });

  const corrupt = (pool: string, field: Partial<ChannelStatus>): Promise<unknown> =>
    gateway.append([
      signClaims(
        withStamp(gateway.stamp(OPERATOR), (t) =>
          channelRecordClaims({ ...gateway.channelStatus(pool)[0]!, ...field }, OPERATOR, t),
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

const panelOf = (html: string): string => {
  const at = html.indexOf("<h2>Channels.</h2>");
  if (at < 0) return "";
  const rest = html.slice(at);
  const list = rest.indexOf("</ul>");
  const next = rest.indexOf("<h2>", 1);
  const end = list < 0 || (next >= 0 && next < list) ? next : list;
  return end < 0 ? rest : rest.slice(0, end);
};

const rowFor = (html: string, pool: string): string => {
  const panel = panelOf(html);
  const at = panel.indexOf(pool);
  if (at < 0) return "";
  const from = panel.lastIndexOf("<li", at);
  if (from < 0) return "";
  const rest = panel.slice(from);
  const end = rest.indexOf("</li>");
  if (end < 0) return "";
  return rest.slice(0, end);
};

describe("T203 — channel health on /admin", () => {
  it("(a) the dashboard shows each subtree channel's lastSyncedAt and consecutiveFailures", async () => {
    const { base, gateway } = await channelServer();

    const status = Object.fromEntries(gateway.channelStatus().map((c) => [c.name, c]));
    expect(status[POOL.alice]!.lastSyncedAt).toBeGreaterThan(1755000000000);
    expect(status[POOL.alice]!.consecutiveFailures).toBe(0);
    expect(status[POOL.carol]!.lastSyncedAt).toBe(0);
    expect(status[POOL.carol]!.consecutiveFailures).toBe(1);
    expect(status[POOL.dave]!.lastSyncedAt).toBe(0);
    expect(status[POOL.dave]!.consecutiveFailures).toBe(0);
    expect(status[POOL.bram]!.receiving).toBe(false);
    expect(status[POOL.dave]!.blessing).toBe(false);

    const ada = await signIn(base, "ada", PASSWORD);
    const html = await textOf(base, ada);

    const synced = rowFor(html, POOL.alice);
    expect(synced).toContain(new Date(status[POOL.alice]!.lastSyncedAt).toISOString());
    expect(synced).toContain("0 consecutive failures");

    const failing = rowFor(html, POOL.carol);
    expect(failing).toContain("never synced");
    expect(failing).not.toMatch(/1970/);
    expect(failing).toContain("1 consecutive failure");

    const quiet = rowFor(html, POOL.dave);
    expect(quiet).toContain("never synced");
    expect(quiet).toContain("0 consecutive failures");

    expect(failing).toContain("<code>carol</code>");
    expect(failing).toContain("receiving · blessing ·");
    expect(failing).not.toContain("not receiving");
    expect(failing).not.toContain("not blessing");
    expect(rowFor(html, POOL.bram)).toContain("not receiving");
    expect(rowFor(html, POOL.dave)).toContain("not blessing");

    expect(synced).toContain(
      `<a href="/admin/container?name=${encodeURIComponent(POOL.alice)}">` +
        `<code>${POOL.alice}</code></a>`,
    );
    expect(synced).toContain(
      `<a href="/admin/container?name=ada%3Afeed"><code>ada:feed</code></a>`,
    );

    const panel = panelOf(html);
    expect(panel).toMatch(/^<h2>Channels\.<\/h2>\n<p>[\s\S]+<\/p>\n<ul>\n<li>/);

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

    expect(rowFor(html, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");

    expect(rowFor(html, POOL.alice)).not.toContain("<strong>");
    expect(rowFor(html, POOL.dave)).not.toContain("<strong>");
  });

  it("(c) the sever surface shows the health of what it would sever", async () => {
    const { base, gateway } = await channelServer();
    const ada = await signIn(base, "ada", PASSWORD);
    const at = new Date(gateway.channelStatus(POOL.alice)[0]!.lastSyncedAt).toISOString();

    const pool = await textOf(base, ada, `/admin/container?name=${encodeURIComponent(POOL.carol)}`);
    expect(rowFor(pool, POOL.carol)).toContain("never synced");
    expect(rowFor(pool, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    expect(pool).toContain(`action="/admin/drop"`);
    expect(pool).toContain("</p>\n<h2>Channels.</h2>");
    expect(rowFor(pool, POOL.alice)).toBe("");

    const token = formTokenOf(await textOf(base, ada));
    const res = await post(base, "/admin/drop", ada, { form_token: token, name: "ada:feed" });
    expect(res.status).toBe(200);
    const confirm = await res.text();
    expect(confirm).toContain("confirm_token");
    expect(rowFor(confirm, POOL.alice)).toContain(at);
    expect(rowFor(confirm, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    expect(rowFor(confirm, POOL.dave)).toContain("never synced");
    expect(confirm.indexOf("never synced")).toBeLessThan(confirm.indexOf("yes — drop it"));

    expect(confirm).toContain("This drop does not sever these channels.");
    expect(confirm.indexOf("does not sever these channels")).toBeLessThan(
      confirm.indexOf("yes — drop it"),
    );
  });

  it("(d) a user whose subtree holds no channel sees no health rows", async () => {
    const { base } = await channelServer();
    const bea = await signIn(base, "bea", PASSWORD);
    const html = await textOf(base, bea);

    for (const pool of Object.values(POOL)) expect(html).not.toContain(pool);
    expect(html).not.toContain("never synced");
    expect(html).not.toContain("consecutive failure");

    expect(panelOf(html)).toContain(
      "<p>No channel receives into a container your subtree reaches.</p>",
    );
    expect(html).not.toContain("No channel receives into your subtree.");

    expect(html).toContain("Your containers.");
    expect(html).toContain("<code>bea</code>");
  });

  it("(e) a corrupt channel record costs its own row and no more", async () => {
    const { base, gateway } = await channelServer();

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

    for (const pool of [POOL.erin, POOL.fred]) {
      const bad = rowFor(html, pool);
      expect(bad).toContain("unreadable");
      expect(bad).not.toContain("never synced");
      expect(bad).not.toContain("consecutive failure");
      expect(bad).not.toContain("NaN");
      expect(bad).not.toContain("Invalid Date");
    }

    expect(rowFor(html, POOL.alice)).toContain("0 consecutive failures");
    expect(rowFor(html, POOL.carol)).toContain("<strong>1 consecutive failure</strong>");
    expect(rowFor(html, POOL.bram)).toContain("not receiving");
  });

  it("(f) a channel this store did not resume says so, and never reads as healthy", async () => {
    const home = mkdtempSync(join(tmpdir(), "loam-t203-boot-"));
    homes.push(home);
    const genesis = assembleGenesis({ operatorSeed: OPERATOR_SEED, registrations: [] });
    const backendFor = (pool: string): SqliteBackend =>
      new SqliteBackend(join(home, `${pool.replace(/[^A-Za-z0-9._-]/g, "_")}.sqlite`));
    const store = (): SqliteBackend => new SqliteBackend(join(home, "store.sqlite"));

    const first = await Gateway.boot(store(), genesis, { channelBackend: backendFor });
    await seedUsers(first);
    const alice = await first.openChannel({
      into: "ada:feed",
      prefix: "alice",
      from: "https://peer.example/default",
      source: reaches,
    });
    await alice.sync();
    await first.close();

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
    expect(row).not.toMatch(/\breceiving\b/);
    expect(row).not.toContain("consecutive failure");
    expect(row).toContain(syncedAt);
    expect(row).toContain("<strong>");

    expect(panelOf(await textOf(base, ada))).toContain("not resumed");
  });
});
