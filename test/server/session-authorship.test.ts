// §36 phase 8 — a session signs as its user (T129). Criteria (a)–(j) of
// .adlc/specs/36-08-a-session-signs-as-its-user.md, transcribed.
//
// EVERY AUTHORSHIP ASSERTION READS THE STORE'S OWN DELTAS, not a rendered view: a view resolves
// values and says nothing about who signed them, so a view-level check would agree with both
// versions of this change (the plan's §2.2 lesson). The mutations go through `graphql`, which is
// the door that SIGNS — `append` carries pre-signed deltas and would prove nothing about the
// identity a token names.
//
// What this file deliberately does NOT assert: the login DELAY (phase 9) and the erasure
// disclosure (phase 10).
//
// FOUR RAILS ARE GREEN BEFORE THE BUILD, and a reader auditing this file should be able to count
// them here rather than discover them: (d) the operator doors stay open — the narrowing this
// phase must not cause; (j) no signing key reaches a response; (k) the constitutional doors keep
// signing as the store; (h) the delta shape is unchanged. Each pins something the change must NOT
// break, so none of them can go red merely for the change being absent — and (h) and (j) each
// carry an assertion that DOES move with the change ((h) compares the two authors; the seed-bytes
// half of (j) lives in (g2), on the refusal branch where a seed is actually in scope). Their
// positive controls are (a)–(c), which prove the feature exists at all. An earlier header named
// only two of the four, which a P5 lens correctly called honest-looking over a weaker set.

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
  readonly seed?: string; // absent = an operator-role user with no seed on this box
  readonly grant?: boolean; // default true: assign-role operator mints a write grant
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
        // What `loam user assign-role --role=operator` lands beside the role claim: write
        // standing for that user's OWN key.
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

/** Sign in, mint, and hand back the bearer token — the whole browser path in one call. */
async function tokenFor(base: string, user: string): Promise<string> {
  const session = await signIn(base, user);
  const res = await mint(base, session);
  expect(res.status, `mint for ${user}`).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** A mutation the DOOR signs — the only path whose author this phase decides. */
const mutate = (base: string, token: string, height: number): Promise<Response> =>
  fetch(`${base}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      query: `mutation { plant(entity: "${FERN}", height: ${height}) { height } }`,
    }),
  });

/**
 * Every delta in the store that set `height` to this value — read at the DELTA level.
 *
 * A door-signed mutation lands as `subject` (the entity, carrying the FIELD as its context) plus
 * `value` (the primitive). Matching both halves is what makes this specific: matching the value
 * alone would collect any field that happened to hold the same number.
 */
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
/** The JSON profile a registration door takes — the shape test/server/http.test.ts uses. */
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

    // And in the same store, the session's write is the user's — so the difference is about
    // SESSIONS, not about the store's own identity having moved.
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
    // ABSOLUTES, not just a relation: two identical FAILURES would satisfy an equality check
    // (the plan's own warning). A real registration must land through the session token.
    expect(asSession.status).toBe(200);
    expect(asOperator.status).toBe(200);
    // Both really registered — a shared failure could not produce two different names.
    expect(((await asSession.json()) as { registered: string }).registered).toBe("Seedling");
    expect(((await asOperator.json()) as { registered: string }).registered).toBe("Sapling");
  });

  it("(e) a struck grant separates authentication from authorization", async () => {
    const { base, gateway, grantIds } = await authorshipServer([
      { name: "ada", seed: ADA_SEED },
      { name: "ben", seed: BEN_SEED },
    ]);
    // Strike ADA's write standing; her ROLE claim stands, so she can still log in.
    await gateway.append([
      signClaims(makeNegationClaims(OPERATOR, 9900, grantIds["ada"]!), OPERATOR_SEED),
    ]);

    const adaToken = await tokenFor(base, "ada"); // she authenticates, and mints
    // The GraphQL door answers a structured refusal at 200 rather than an HTTP status — so the
    // rail reads the body and, more importantly, the STORE: nothing may have landed.
    const refused = await mutate(base, adaToken, 66);
    expect(((await refused.json()) as { errors: string[] }).errors.join(" ")).toMatch(
      /not permitted/,
    );
    expect(authorsOfHeight(gateway, 66)).toEqual([]); // nothing landed

    // Two-sided: BEN, whose grant survives, still writes — so the refusal is about the GRANT,
    // not about the door being shut.
    expect((await mutate(base, await tokenFor(base, "ben"), 67)).status).toBe(200);
    expect(authorsOfHeight(gateway, 67)).toEqual([BEN]);
  });

  it("(f) an operator-role user with no seed on this box fails CLOSED, by name", async () => {
    const { base, gateway, home } = await authorshipServer([{ name: "ada" }]); // no seed written
    const session = await signIn(base, "ada");
    const refused = await mint(base, session);
    expect(refused.status).toBe(409);
    const body = await refused.text();
    expect(body).toContain("ada");
    // The cure must be a command that works in THIS state. `assign-role` alone refuses a role
    // already held — and this 409 is only reachable for a user who holds it — so the message
    // must name the pair (a P5 lens caught it sending the operator to a guaranteed no-op).
    expect(body).toMatch(/remove-role/);
    expect(body).toMatch(/assign-role/);
    expect(body).not.toContain(home); // no path reaches the caller

    // Nothing was minted, and no fallback wrote anything. The store-level check that would
    // catch a fallback directly is out of reach in this fixture — ada's seed never reaches this
    // process, so no delta here could carry her author under ANY implementation, and a fallback
    // would sign as the operator, which every fixture delta already does (a P5 lens caught the
    // earlier assertion being a tautology). What IS reachable: the refusal handed back no token,
    // so nothing can write at all.
    expect(Object.keys(JSON.parse(body) as Record<string, unknown>)).toEqual(["errors"]);
    const snapshot = [...gateway.reactor.snapshot()].length;
    expect((await mint(base, session)).status).toBe(409); // still refused, still no token
    expect([...gateway.reactor.snapshot()].length).toBe(snapshot); // and nothing landed
  });

  it("(g) an unreadable seed fails the same way, detail to the operator only", async () => {
    const faults: string[] = [];
    const { base, home } = await authorshipServer([{ name: "ada", seed: ADA_SEED }], {
      onFault: (m) => faults.push(m),
    });
    const session = await signIn(base, "ada");
    expect((await mint(base, session)).status).toBe(200); // positive control

    unlinkSync(userSeedPath(home, "ada"));
    mkdirSync(userSeedPath(home, "ada")); // present but unreadable
    const refused = await mint(base, session);
    expect(refused.status).toBe(409);
    expect(await refused.text()).not.toContain(home);
    expect(faults.some((m) => m.includes(home))).toBe(true);
  });

  it("(g2) a seed that is present but NOT A KEY fails closed too — the third state", async () => {
    // readUserSeed answers a two-state question (absent / unreadable); a seed file has a third
    // state, and a premortem caught it failing OPEN: a crashed write leaves a zero-byte file,
    // which reads as "present" and mints {actor: ""} — not nullish, so nothing falls back and
    // the failure surfaces as an opaque error at the first write instead of a refusal here.
    // One junk value is deliberately SECRET-SHAPED (64 chars, wrong alphabet): if the refusal
    // branch ever printed the file's bytes, only a value that looks like a key would prove it.
    // (j) can only watch the success path, where no seed is in scope — a P5 lens showed its
    // fault-channel half passing on an empty array.
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
      // The seed's own BYTES never travel either — not to the caller, not to the operator
      // channel. (j) can only watch the success path, where no seed is in scope; this refusal
      // branch is the one place the seed's neighbourhood is formatted into text, so a mutant
      // appending it here is caught here (a P5 lens's finding). The junk values are known
      // strings, which is what makes the assertion cheap and real.
      if (junk.trim() !== "") {
        expect(body).not.toContain(junk);
        expect(faults.join("\n")).not.toContain(junk);
      }
      expect(faults.some((m) => m.includes(home))).toBe(true);
    }
  });

  it("(k) the constitutional doors still sign as the STORE — a deliberate, railed limit", async () => {
    // `register` (and the renderer's pen, and artifact) publish LAW, and publishRegistration
    // refuses any author but the store's own. So a session token opens those doors — (d) — while
    // what they write still carries the store's name. A premortem found the headline overclaiming
    // here; the limit is real and stated in §36.8 rather than discovered later as a bug.
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
    // Every delta the door published is the STORE's, not Ada's.
    for (const delta of added) expect(delta.claims.author).toBe(OPERATOR);
    expect(added.map((d) => d.claims.author)).not.toContain(ADA);
  });

  it("(m) every signing door agrees on the name", async () => {
    // The seam is contextFor, shared by graphql, rest and mcp — a door-specific implementation
    // would give one person two names depending on which door they used. `loam_mutate` is the
    // MCP write tool (`loam_query` is the read door and refuses a mutation by name).
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
    // The write really landed through that door — no vacuous branch — and it carries Ada's name.
    expect(authorsOfHeight(gateway, 74)).toEqual([ADA]);

    // THE REST DOOR IS A NAMED GAP, not a silent one. It reaches the same seam by a different
    // expression — `contextFor(identity)?.actor`, passed positionally rather than as a context
    // object (src/server/http.ts) — so it is the door most likely to drift: a mutant passing
    // `undefined` there would let rest write as the store while graphql and mcp carried the
    // user's name, one person with two names, and nothing in this file would go red.
    //
    // It is not railed here because the REST door addresses a schema by VERSION ALIAS, which
    // only a delta-borne registration mints; this fixture registers in-process, so `/rest/v1/
    // Plant` answers "no version v1 of Plant survives" and a rail written against it would be
    // asserting on a 404. Closing it wants a fixture that registers through the door and then
    // writes the registered field — worth doing, and worth doing deliberately rather than
    // wedged into this test. A P5 lens found the earlier version of this comment claiming three
    // doors while exercising two.
  });

  it("(l) two users writing the identical claim produce two distinct deltas", async () => {
    // The author is part of a delta's content address (H4), so identical claims from two people
    // no longer collide into one delta. The SHAPE is unchanged and no migration is owed — but
    // the address necessarily moves, and that is a railed fact rather than a surprise.
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
    // Same roles, same target kinds, same claim fields — AND the authors genuinely differ, which
    // is what makes "the author's value is the only difference" a claim rather than a hope. A P5
    // lens caught this asserting the shape alone: green with the feature deleted.
    expect(shapeOf(69)).toEqual(shapeOf(68));
    expect(authorsOfHeight(gateway, 68)).toEqual([OPERATOR]);
    expect(authorsOfHeight(gateway, 69)).toEqual([ADA]);
  });

  it("(i) the seed is read at MINT time, not at login", async () => {
    const { base, gateway, home } = await authorshipServer([{ name: "ada" }]); // starts seedless
    const session = await signIn(base, "ada"); // logs in BEFORE any seed exists
    expect((await mint(base, session)).status).toBe(409);

    // Written after sign-in: the NEXT mint picks it up, and the write carries that author.
    writeUserSeed(home, "ada", ADA_SEED);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, 9500), OPERATOR_SEED),
    ]);
    const res = await mint(base, session);
    expect(res.status).toBe(200);
    const token = ((await res.json()) as { token: string }).token;
    expect((await mutate(base, token, 70)).status).toBe(200);
    expect(authorsOfHeight(gateway, 70)).toEqual([ADA]);

    // Deleted after a successful mint: the NEXT mint fails closed, while the token already
    // issued keeps working until its own window ends.
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
