import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { hashPassword, writeCredentials, type ScryptParams } from "../../src/server/credentials.js";
import { roleClaims, userClaims } from "../../src/server/users.js";
import { PRESESSION_COOKIE, SESSION_COOKIE } from "../../src/server/session.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { writeUserSeed, userSeedPath } from "../../src/cli/config.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden } from "./../gateway/fixtures.js";
import { FERN, GARDENER, SURVEYOR } from "../spike/garden.js";

vi.setConfig({ testTimeout: 25000 });

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "ad".repeat(32);
const BEN_SEED = "be".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const BEN = authorForSeed(BEN_SEED);
const CHEAP: ScryptParams = { N: 1024, r: 8, p: 1, keylen: 32 };
const PASSWORD = "correct horse";
const SAME_ORIGIN = { "sec-fetch-site": "same-origin" } as const;

const homes: string[] = [];
const handles: ServerHandle[] = [];
afterEach(async () => {
  while (handles.length > 0) await handles.pop()!.close();
  while (homes.length > 0) rmSync(homes.pop()!, { recursive: true, force: true });
});

interface Person {
  readonly name: string;
  readonly seed?: string;
  readonly grant?: boolean;
}

async function authorshipServer(
  people: readonly Person[],
  extra: { onFault?: (m: string) => void } = {},
): Promise<{
  base: string;
  handle: ServerHandle;
  gateway: Gateway;
  home: string;
  grantIds: Record<string, string>;
}> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR, 9000), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, SURVEYOR, "write", OPERATOR, 9001), OPERATOR_SEED),
  ]);
  await gateway.append(garden);
  gateway.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);

  const home = mkdtempSync(join(tmpdir(), "loam-authorship-"));
  homes.push(home);
  const users: Record<string, Awaited<ReturnType<typeof hashPassword>>> = {};
  const grantIds: Record<string, string> = {};
  let ts = 9100;
  for (const person of people) {
    users[person.name] = await hashPassword(PASSWORD, CHEAP);
    await gateway.append([signClaims(userClaims(person.name, OPERATOR, ts++), OPERATOR_SEED)]);
    await gateway.append([
      signClaims(roleClaims(person.name, "operator", OPERATOR, ts++), OPERATOR_SEED),
    ]);
    if (person.seed !== undefined) {
      writeUserSeed(home, person.name, person.seed);
      if (person.grant !== false) {
        const grant = signClaims(
          grantClaims(STORE_ENTITY, authorForSeed(person.seed), "write", OPERATOR, ts++),
          OPERATOR_SEED,
        );
        grantIds[person.name] = grant.id;
        await gateway.append([grant]);
      }
    }
  }
  writeCredentials(home, { version: 1, users });

  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
    users: {
      home,
      mount: "default",
      ...(extra.onFault === undefined ? {} : { onFault: extra.onFault }),
    },
  });
  handles.push(handle);
  return { base: handle.url, handle, gateway, home, grantIds };
}

const cookiesOf = (res: Response): string[] => res.headers.getSetCookie();
const valueOf = (header: string): string => {
  const eq = header.indexOf("=");
  return header.slice(eq + 1, header.indexOf(";"));
};

async function signIn(
  base: string,
  user: string,
): Promise<{ sessionId: string; sessionToken: string }> {
  const form = await fetch(`${base}/login`);
  const nonce = valueOf(cookiesOf(form).find((c) => c.startsWith(`${PRESESSION_COOKIE}=`))!);
  const token = /name="form_token" value="([^"]+)"/.exec(await form.text())?.[1];
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${PRESESSION_COOKIE}=${nonce}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: token!, user, password: PASSWORD }).toString(),
  });
  expect(res.status).toBe(200);
  const sessionId = valueOf(cookiesOf(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!);
  const sessionToken = /name="form_token" value="([^"]+)"/.exec(await res.text())?.[1];
  return { sessionId, sessionToken: sessionToken! };
}

const mint = (
  base: string,
  session: { sessionId: string; sessionToken: string },
): Promise<Response> =>
  fetch(`${base}/session/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: `${SESSION_COOKIE}=${session.sessionId}`,
      ...SAME_ORIGIN,
    },
    body: new URLSearchParams({ form_token: session.sessionToken }).toString(),
  });

async function tokenFor(base: string, user: string): Promise<string> {
  const session = await signIn(base, user);
  const res = await mint(base, session);
  expect(res.status, `mint for ${user}`).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

const mutate = (base: string, token: string, height: number): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    }),
  });

const heightDeltas = (gateway: Gateway, height: number): Delta[] =>
  [...gateway.reactor.snapshot()].filter(
    (d: Delta) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "value" && p.target.kind === "primitive" && p.target.value === height,
      ),
  );

const authorsOfHeight = (gateway: Gateway, height: number): string[] =>
  heightDeltas(gateway, height).map((d) => d.claims.author);

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const registration = (name: string): string =>
  JSON.stringify({
    hyperschema: {
      name,
      alg: 1,
      body: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    },
    schema: { props: { color: PICK }, default: PICK },
    roots: [`${name.toLowerCase()}:1`],
    writable: ["color"],
  });

describe("§36 phase 8 — a session signs as its user", () => {
  it("(a) a session's write carries that user's own author, not the store's", async () => {
    const { base, gateway } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    const token = await tokenFor(base, "ada");
    expect((await mutate(base, token, 61)).status).toBe(200);

    const authors = authorsOfHeight(gateway, 61);
    expect(authors).toHaveLength(1);
    expect(authors[0]).toBe(ADA);
    expect(authors[0]).not.toBe(OPERATOR);
  });

  it("(b) two sessions are distinguishable at the delta level", async () => {
    const { base, gateway } = await authorshipServer([
      { name: "ada", seed: ADA_SEED },
      { name: "ben", seed: BEN_SEED },
    ]);
    expect((await mutate(base, await tokenFor(base, "ada"), 62)).status).toBe(200);
    expect((await mutate(base, await tokenFor(base, "ben"), 63)).status).toBe(200);

    const adaAuthors = authorsOfHeight(gateway, 62);
    const benAuthors = authorsOfHeight(gateway, 63);
    expect(adaAuthors).toEqual([ADA]);
    expect(benAuthors).toEqual([BEN]);
    expect(adaAuthors[0]).not.toBe(benAuthors[0]);
  });

  it("(c) the static operator token still signs as the store — two-sided against (a)", async () => {
    const { base, gateway } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    expect((await mutate(base, "op-token", 64)).status).toBe(200);
    expect(authorsOfHeight(gateway, 64)).toEqual([OPERATOR]);

    expect((await mutate(base, await tokenFor(base, "ada"), 65)).status).toBe(200);
    expect(authorsOfHeight(gateway, 65)).toEqual([ADA]);
  });

  it("(d) the operator doors stay open to a session token — no silent narrowing", async () => {
    const { base } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    const token = await tokenFor(base, "ada");
    const asSession = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: registration("Seedling"),
    });
    const asOperator = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer op-token" },
      body: registration("Sapling"),
    });
    expect(asSession.status).toBe(200);
    expect(asOperator.status).toBe(200);
    expect(((await asSession.json()) as { registered: string }).registered).toBe("Seedling");
    expect(((await asOperator.json()) as { registered: string }).registered).toBe("Sapling");
  });

  it("(e) a struck grant separates authentication from authorization", async () => {
    const { base, gateway, grantIds } = await authorshipServer([
      { name: "ada", seed: ADA_SEED },
      { name: "ben", seed: BEN_SEED },
    ]);
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 9900, grantIds["ada"]!), OPERATOR_SEED),
    ]);

    const adaToken = await tokenFor(base, "ada");
    const refused = await mutate(base, adaToken, 66);
    expect(((await refused.json()) as { errors: string[] }).errors.join(" ")).toMatch(
      /not permitted/,
    );
    expect(authorsOfHeight(gateway, 66)).toEqual([]);

    expect((await mutate(base, await tokenFor(base, "ben"), 67)).status).toBe(200);
    expect(authorsOfHeight(gateway, 67)).toEqual([BEN]);
  });

  it("(f) an operator-role user with no seed on this box fails CLOSED, by name", async () => {
    const { base, gateway, home } = await authorshipServer([{ name: "ada" }]);
    const session = await signIn(base, "ada");
    const refused = await mint(base, session);
    expect(refused.status).toBe(409);
    const body = await refused.text();
    expect(body).toContain("ada");
    expect(body).toMatch(/remove-role/);
    expect(body).toMatch(/assign-role/);
    expect(body).not.toContain(home);

    expect(Object.keys(JSON.parse(body) as Record<string, unknown>)).toEqual(["errors"]);
    const snapshot = [...gateway.reactor.snapshot()].length;
    expect((await mint(base, session)).status).toBe(409);
    expect([...gateway.reactor.snapshot()].length).toBe(snapshot);
  });

  it("(g) an unreadable seed fails the same way, detail to the operator only", async () => {
    const faults: string[] = [];
    const { base, home } = await authorshipServer([{ name: "ada", seed: ADA_SEED }], {
      onFault: (m) => faults.push(m),
    });
    const session = await signIn(base, "ada");
    expect((await mint(base, session)).status).toBe(200);

    unlinkSync(userSeedPath(home, "ada"));
    mkdirSync(userSeedPath(home, "ada"));
    const refused = await mint(base, session);
    expect(refused.status).toBe(409);
    expect(await refused.text()).not.toContain(home);
    expect(faults.some((m) => m.includes(home))).toBe(true);
  });

  it("(g2) a seed that is present but NOT A KEY fails closed too — the third state", async () => {
    for (const junk of ["", "   \n", "not-a-key", "ad".repeat(16), "zz".repeat(32)]) {
      const faults: string[] = [];
      const { base, home } = await authorshipServer([{ name: "ada", seed: ADA_SEED }], {
        onFault: (m) => faults.push(m),
      });
      const session = await signIn(base, "ada");
      expect((await mint(base, session)).status, `control for ${JSON.stringify(junk)}`).toBe(200);

      writeFileSync(userSeedPath(home, "ada"), junk);
      const refused = await mint(base, session);
      expect(refused.status, JSON.stringify(junk)).toBe(409);
      const body = await refused.text();
      expect(body).not.toContain(home);
      if (junk.trim() !== "") {
        expect(body).not.toContain(junk);
        expect(faults.join("\n")).not.toContain(junk);
      }
      expect(faults.some((m) => m.includes(home))).toBe(true);
    }
  });

  it("(k) the constitutional doors still sign as the STORE — a deliberate, railed limit", async () => {
    const { base, gateway } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    const token = await tokenFor(base, "ada");
    const before = [...gateway.reactor.snapshot()].length;
    const res = await fetch(`${base}/default/register`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: registration("Sprout"),
    });
    expect(res.status).toBe(200);
    const added = [...gateway.reactor.snapshot()].slice(before);
    expect(added.length).toBeGreaterThan(0);
    for (const delta of added) expect(delta.claims.author).toBe(OPERATOR);
    expect(added.map((d) => d.claims.author)).not.toContain(ADA);
  });

  it("(m) every signing door agrees on the name", async () => {
    const { base, gateway } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    const token = await tokenFor(base, "ada");
    expect((await mutate(base, token, 73)).status).toBe(200);
    expect(authorsOfHeight(gateway, 73)).toEqual([ADA]);

    const mcp = await fetch(`${base}/default/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "loam_mutate",
          arguments: {
            mutation: `mutation { plant(entity: "${FERN}", height: 74) { height } }`,
          },
        },
      }),
    });
    expect(mcp.status).toBe(200);
    expect(authorsOfHeight(gateway, 74)).toEqual([ADA]);
  });

  it("(l) two users writing the identical claim produce two distinct deltas", async () => {
    const { base, gateway } = await authorshipServer([
      { name: "ada", seed: ADA_SEED },
      { name: "ben", seed: BEN_SEED },
    ]);
    expect((await mutate(base, await tokenFor(base, "ada"), 72)).status).toBe(200);
    expect((await mutate(base, await tokenFor(base, "ben"), 72)).status).toBe(200);
    const deltas = heightDeltas(gateway, 72);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]!.id).not.toBe(deltas[1]!.id);
    expect(new Set(deltas.map((d) => d.claims.author))).toEqual(new Set([ADA, BEN]));
  });

  it("(h) no delta changes shape: only the author's value differs", async () => {
    const { base, gateway } = await authorshipServer([{ name: "ada", seed: ADA_SEED }]);
    expect((await mutate(base, "op-token", 68)).status).toBe(200);
    expect((await mutate(base, await tokenFor(base, "ada"), 69)).status).toBe(200);

    const shapeOf = (height: number): unknown => {
      const delta = heightDeltas(gateway, height)[0]!;
      return {
        roles: delta.claims.pointers.map((p) => p.role).sort(),
        kinds: delta.claims.pointers.map((p) => p.target.kind).sort(),
        fields: Object.keys(delta.claims).sort(),
      };
    };
    expect(shapeOf(69)).toEqual(shapeOf(68));
    expect(authorsOfHeight(gateway, 68)).toEqual([OPERATOR]);
    expect(authorsOfHeight(gateway, 69)).toEqual([ADA]);
  });

  it("(i) the seed is read at MINT time, not at login", async () => {
    const { base, gateway, home } = await authorshipServer([{ name: "ada" }]);
    const session = await signIn(base, "ada");
    expect((await mint(base, session)).status).toBe(409);

    writeUserSeed(home, "ada", ADA_SEED);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, 9500), OPERATOR_SEED),
    ]);
    const res = await mint(base, session);
    expect(res.status).toBe(200);
    const token = ((await res.json()) as { token: string }).token;
    expect((await mutate(base, token, 70)).status).toBe(200);
    expect(authorsOfHeight(gateway, 70)).toEqual([ADA]);

    unlinkSync(userSeedPath(home, "ada"));
    expect((await mint(base, session)).status).toBe(409);
    expect((await mutate(base, token, 71)).status).toBe(200);
    expect(authorsOfHeight(gateway, 71)).toEqual([ADA]);
  });

  it("(j) the signing key never leaves the process", async () => {
    const faults: string[] = [];
    const { base } = await authorshipServer([{ name: "ada", seed: ADA_SEED }], {
      onFault: (m) => faults.push(m),
    });
    const session = await signIn(base, "ada");
    const res = await mint(base, session);
    const body = await res.text();
    expect(body).not.toContain(ADA_SEED);
    const page = await fetch(`${base}/login`, {
      headers: { cookie: `${SESSION_COOKIE}=${session.sessionId}` },
    });
    expect(await page.text()).not.toContain(ADA_SEED);
    expect(faults.join("\n")).not.toContain(ADA_SEED);
  });
});
