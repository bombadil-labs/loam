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
import { containerClaims } from "../../src/gateway/container-law.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed } from "../../src/cli/config.js";
import { signIn } from "../helpers/session-fixture.js";
import { FERN } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { withStamp } from "../../src/gateway/stamp.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ALICE_SEED = "a1".repeat(32);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const ADA_SEED = "aa".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const BEA_SEED = "bb".repeat(32);
const BEA = authorForSeed(BEA_SEED);

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

async function seedUsers(gateway: Gateway): Promise<void> {
  let ts = 9001;
  const op = (claims: Claims): Promise<unknown> =>
    gateway.append([signClaims(claims, OPERATOR_SEED)]);
  for (const [name, key] of [
    ["ada", ADA],
    ["bea", BEA],
  ] as const) {
    await op(userClaims(name, OPERATOR, ts++));
    await op(roleClaims(name, "actor", OPERATOR, ts++));
    await op(
      containerClaims(
        { container: name, trust: "curated", posture: "shared", membership: authoredBy(key) },
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
  writeCredentials(home, { version: 1, users: { ada: hash, bea: hash } });
  writeUserSeed(home, "ada", ADA_SEED);
  writeUserSeed(home, "bea", BEA_SEED);
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

const defined = (name: string): HyperSchema => ({ name, alg: 1, body: PLANT.body });

async function contestedServer(): Promise<{ base: string; gateway: Gateway }> {
  const alice = await Gateway.open(new MemoryBackend(), { seed: ALICE_SEED });
  grounds.push(alice);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedUsers(gateway);
  await gateway.append([
    signClaims(
      withStamp(gateway.stamp(OPERATOR), (t) => bindingPolicyClaims("conflicts", OPERATOR, t)),
      OPERATOR_SEED,
    ),
  ]);
  const channel = await gateway.openChannel({
    into: "ada:feed",
    prefix: "alice",
    source: { pull: () => Promise.resolve(alice.reactor.arrivalLog()) },
  });
  await channel.sync();
  await gateway.publishRegistration(
    defined("Rival"),
    { ...PLANT_POLICY, name: "alice:Plant" },
    [FERN],
    undefined,
    "hyperschema:Rival",
  );
  for (const lens of ["burdock", "camellia"]) {
    for (const n of ["One", "Two"]) {
      await gateway.publishRegistration(
        defined(`${lens}${n}`),
        { ...PLANT_POLICY, name: lens },
        [FERN],
        undefined,
        `hyperschema:${lens}${n}`,
      );
    }
  }
  return { base: await doorOver(gateway), gateway };
}

async function calmServer(): Promise<{ base: string; gateway: Gateway }> {
  const alice = await Gateway.open(new MemoryBackend(), { seed: ALICE_SEED });
  grounds.push(alice);
  await alice.publishRegistration(PLANT, PLANT_POLICY, [FERN]);

  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await seedUsers(gateway);
  await gateway.append([
    signClaims(
      withStamp(gateway.stamp(OPERATOR), (t) => bindingPolicyClaims("conflicts", OPERATOR, t)),
      OPERATOR_SEED,
    ),
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

const panelOf = (html: string): string => {
  const at = html.indexOf(`<section class="contested">`);
  if (at < 0) return "";
  const rest = html.slice(at);
  const end = rest.indexOf("</section>");
  return end < 0 ? "" : rest.slice(0, end);
};

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

    expect(() => gateway.def("alice:Plant")).toThrow();
    expect(() => gateway.def("burdock")).toThrow();
    const reading = gateway.contestedNames();
    expect([...reading.keys()].sort()).toEqual(["alice:Plant", "burdock", "camellia"]);
    const rows = reading.get("alice:Plant")!.contenders;
    expect(rows.map((r) => r.origin).sort()).toEqual([POOL, "root"]);
    expect(rows.some((r) => r.served)).toBe(false);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    const panel = panelOf(html);
    expect(panel).toContain("<strong>alice:Plant</strong>");
    expect(panel).toContain(POOL);
    expect(panel).toContain("root");
    expect(panel).toContain("hyperschema:Rival");

    for (const row of rows) {
      const rendered = rowFor(html, row.deltaId);
      expect(rendered, `no row for ${row.origin}`).not.toBe("");
      expect(rendered).toContain(`<code>${row.origin}</code>`);
      expect(rendered).toContain(row.author);
      expect(rendered).toContain(new Date(row.timestamp).toISOString());
    }

    const at = (name: string): number => panel.indexOf(`<strong>${name}</strong>`);
    expect(at("alice:Plant")).toBeGreaterThan(-1);
    expect(at("alice:Plant")).toBeLessThan(at("burdock"));
    expect(at("burdock")).toBeLessThan(at("camellia"));
  });

  it("(c) a reader is not shown the name of a channel pool their subtree does not reach", async () => {
    const { base, gateway } = await contestedServer();
    grounds.push(gateway);

    const html = await textOf(base, await signIn(base, "bea", PASSWORD));
    const panel = panelOf(html);
    expect(panel).toContain("<strong>alice:Plant</strong>");
    expect(panel).toContain("hyperschema:Rival");
    for (const row of gateway.contestedNames().get("alice:Plant")!.contenders) {
      const rendered = rowFor(html, row.deltaId);
      expect(rendered).toContain(row.author);
      expect(rendered).toContain(row.entity);
    }
    expect(panel).not.toContain(POOL);
    expect(panel).toContain("a channel pool your subtree does not reach");
    expect(panelOf(await textOf(base, await signIn(base, "ada", PASSWORD)))).toContain(POOL);
  });

  it("(c) a store withholding nothing renders no block at all", async () => {
    const { base, gateway } = await calmServer();
    grounds.push(gateway);

    expect(gateway.def("alice:Plant")).toBeDefined();
    expect(gateway.contestedNames().size).toBe(0);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    expect(panelOf(html)).toBe("");
    expect(html).not.toContain("Contested names.");
    expect(html).toContain("<h2>Schemas.</h2>");
  });

  it("(d) the block matches the gateway reading, row for row, and invents no row", async () => {
    const { base, gateway } = await contestedServer();
    grounds.push(gateway);

    const html = await textOf(base, await signIn(base, "ada", PASSWORD));
    const panel = panelOf(html);
    const reading = gateway.contestedNames();
    expect(reading.size).toBe(3);

    let contenders = 0;
    for (const [lens, report] of reading) {
      expect(panel).toContain(`<strong>${lens}</strong>`);
      expect(report.contenders.length).toBeGreaterThan(1);
      for (const row of report.contenders) {
        contenders += 1;
        const rendered = rowFor(html, row.deltaId);
        expect(rendered).toContain(row.entity);
        expect(rendered).toContain(`<code>${row.origin}</code>`);
        expect(rendered).toContain(row.author);
        expect(rendered).toContain(new Date(row.timestamp).toISOString());
        expect(rendered).toContain(row.deltaId);
      }
    }
    expect(panel.split("<li").length - 1).toBe(contenders + reading.size);
  });
});
