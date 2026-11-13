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
import { containerClaims } from "../../src/gateway/container-law.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { signIn } from "../helpers/session-fixture.js";
import { withStamp } from "../../src/gateway/stamp.js";

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

  const built = withStamp(gateway.stamp(OPERATOR), (t) =>
    channelRecordClaims(gateway.channelStatus(BRAM)[0]!, OPERATOR, t),
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
  return end < 0 ? "" : rest.slice(0, end);
};

describe("T217 — the channels panel will not guess at a record it cannot read", () => {
  it("a record missing a health field renders UNREADABLE and names the field", async () => {
    const { base, gateway } = await channelServer();

    const bad = gateway.channelStatus(BRAM)[0]!;
    expect(bad.unreadable).toContain("lastSyncedAt");
    expect(Number.isFinite(bad.lastSyncedAt)).toBe(true);
    expect(bad.lastSyncedAt).toBe(0);

    const ada = await signIn(base, "ada", PASSWORD);
    const res = await fetch(`${base}/admin`, {
      redirect: "manual",
      headers: { cookie: `${SESSION_COOKIE}=${ada}` },
    });
    expect(res.status).toBe(200);
    const html = await res.text();

    const row = rowFor(html, BRAM);
    expect(row).not.toBe("");
    expect(row).toContain("<strong>unreadable");
    expect(row).toContain("lastSyncedAt");
    expect(row).not.toContain("never synced");
    expect(row).not.toContain("consecutive failure");
    expect(row).not.toContain("NaN");
    expect(row).not.toContain("Invalid Date");

    expect(row).toContain(BRAM);
    expect(row).not.toContain("the peer you call");
    expect(row).not.toContain("/admin/container?name=ada%3Afeed");

    const good = rowFor(html, ALICE);
    expect(good).not.toBe("");
    expect(good).not.toContain("unreadable");
    expect(good).toContain("receiving");
    expect(good).toContain("0 consecutive failures");
    expect(good).toContain(new Date(gateway.channelStatus(ALICE)[0]!.lastSyncedAt).toISOString());
  });
});
