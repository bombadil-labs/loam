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
import { containerClaims } from "../../src/gateway/container-law.js";
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

const POOL = {
  alice: "channel:opal:feed:alice",
  zeb: "channel:opal:feed:zeb",
  carol: "channel:opal:live:carol",
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

const orphanPanelOf = (html: string): string => {
  const marker = "<h2>Orphaned channels.</h2>";
  const at = html.indexOf(marker);
  if (at < 0) return "";
  const rest = html.slice(at + marker.length);
  const next = rest.indexOf("<h2>");
  return next < 0 ? rest : rest.slice(0, next);
};

async function orphanServer(): Promise<{ base: string; gateway: Gateway }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedUsers(gateway);

  await gateway.openChannel({ into: "opal:feed", prefix: "zeb", source: reaches });
  const alice = await gateway.openChannel({
    into: "opal:feed",
    prefix: "alice",
    source: unreachable,
  });
  await expect(alice.sync()).rejects.toThrow(/did not answer/);
  await gateway.openChannel({ into: "opal:live", prefix: "carol", source: reaches });

  const base = await doorOver(gateway);

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

    const table = gateway.containers();
    expect(table.containers.has("opal:feed")).toBe(false);
    expect(table.containers.has("opal:live")).toBe(true);
    const status = Object.fromEntries(gateway.channelStatus().map((c) => [c.name, c]));
    expect(status[POOL.alice]!.into).toBe("opal:feed");
    expect(status[POOL.alice]!.receiving).toBe(true);
    expect(status[POOL.alice]!.consecutiveFailures).toBe(1);
    expect(status[POOL.carol]!.into).toBe("opal:live");

    const opal = await signIn(base, "opal", PASSWORD);
    const panel = orphanPanelOf(await textOf(base, opal));
    expect(panel).toContain(POOL.alice);
    expect(panel).toContain("<strong>1 consecutive failure</strong>");
    expect(panel).toContain(`loam federate drop --channel ${POOL.alice} --yes`);
    expect(panel).toContain(`loam federate set --channel ${POOL.alice} --receiving false`);

    expect(panel).toContain(POOL.zeb);

    expect(panel.indexOf(POOL.alice)).toBeLessThan(panel.indexOf(POOL.zeb));

    expect(panel).not.toContain(POOL.carol);
  });

  it("(b) a non-operator sees no orphan block, and the operator's block is why", async () => {
    const { base } = await orphanServer();

    const nina = await signIn(base, "nina", PASSWORD);
    const ninaPage = await textOf(base, nina);
    expect(ninaPage).not.toContain("Orphaned channels.");
    expect(ninaPage).not.toContain(POOL.alice);
    expect(ninaPage).toContain("Your containers.");
    expect(ninaPage).toContain("<code>nina</code>");

    const opal = await signIn(base, "opal", PASSWORD);
    expect(await textOf(base, opal)).toContain("Orphaned channels.");
  });

  it("(c) an operator with no orphaned channel sees no block — absent, not empty", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    await seedUsers(gateway);
    await gateway.openChannel({ into: "opal:live", prefix: "carol", source: reaches });
    const base = await doorOver(gateway);

    const opal = await signIn(base, "opal", PASSWORD);
    const page = await textOf(base, opal);
    expect(page).not.toContain("Orphaned channels.");
    expect(page).toContain("<h2>Channels.</h2>");
    expect(page).toContain(POOL.carol);
  });
});
