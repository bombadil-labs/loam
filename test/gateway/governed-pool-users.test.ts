// A ground that reads its users from a HOST (a container pool) must follow the host's users: its
// governed views trust the root a user-named grant resolves to, and that root lives in claims its
// own reactor never holds. Asked through the stream door and the point door of the pool itself, at
// the three moments the root can move without anything arriving in the pool: the pool starts
// reading the host, the host re-points the user, and a root claim's window opens in the host.
//
// The pool here is a Gateway wired to its host with `readUsersFrom`, as container.ts wires every
// pool it opens; the container machinery itself is not what these rails ask about.

import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Delta,
  type HyperSchema,
} from "@bombadil/rhizomatic";
import { governedGatherBody, grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const K1_SEED = "d1".repeat(32);
const K1 = authorForSeed(K1_SEED);
const K2_SEED = "d2".repeat(32);
const K2 = authorForSeed(K2_SEED);

const MOSS = "plant:moss";
const GUARDED: HyperSchema = { name: "Guarded", alg: 1, body: governedGatherBody(OP) };
const op = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);
const strike = (seed: string, target: Delta, t: number): Delta =>
  signClaims(makeNegationClaims(authorForSeed(seed), t, target.id), seed);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

async function governed(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        {
          hyperschema: GUARDED,
          schema: PLANT_POLICY,
          roots: [FERN],
          writable: [...PLANT_WRITABLE],
        },
      ],
    }),
  );
  open.push(gw);
  return gw;
}

// A host holding ada's user record (root K1), and a pool whose grants name ada. In the pool, the
// gardener wrote 30 then 34, and K2 struck 34: inert while ada's root is K1, binding once it is K2.
async function world(t0: number): Promise<{ host: Gateway; pool: Gateway }> {
  const host = await governed();
  await host.append([op(userClaims("ada", OP, t0)), op(rootClaims("ada", K1, OP, t0))]);
  const pool = await governed();
  const later = observed(FERN, "height", 34, t0 + 2, GARDENER_SEED);
  await pool.append([
    op(grantClaims(STORE_ENTITY, GARDENER, "write", OP, t0)),
    op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, t0)),
  ]);
  await pool.append([observed(FERN, "height", 30, t0 + 1, GARDENER_SEED), later]);
  await pool.federate([strike(K2_SEED, later, t0 + 3)]);
  return { host, pool };
}

const heightOf = async (gw: Gateway): Promise<unknown> =>
  (
    (await gw.query(`{ guarded(entity: "${FERN}") { height } }`)).data as {
      guarded: { height: unknown };
    }
  ).guarded.height;

// The next frame, or "no frame" — awaited, never raced against a tick.
async function nextFrame(stream: AsyncGenerator<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("no frame"), ms);
  });
  const frame = stream
    .next()
    .then((r) => (r.value as { guarded: { height: unknown } }).guarded.height);
  const won = await Promise.race([frame, timeout]);
  clearTimeout(timer);
  return won;
}

describe("R5: a pool follows its host's users", () => {
  it("views built before the pool reads its host are re-read when it starts", async () => {
    const t0 = Date.now() - 10_000;
    const host = await governed();
    await host.append([op(userClaims("ada", OP, t0)), op(rootClaims("ada", K2, OP, t0))]);
    const { pool } = await world(t0);
    // The pool's own ground holds no users, so K2's strike is inert: 34 is served.
    expect(await heightOf(pool)).toBe(34);
    pool.readUsersFrom(host);
    // Nothing arrived in the pool; its views re-read ada's root (K2) from the host.
    expect(await heightOf(pool)).toBe(30);
    // delta level: the strike and the struck value are both still held in the pool
    expect(pool.reactor.size).toBeGreaterThan(0);
  });

  it("an open stream on the pool gets a frame when the host re-points the user", async () => {
    const t0 = Date.now() - 10_000;
    const { host, pool } = await world(t0);
    pool.readUsersFrom(host);
    const stream = await pool.subscribe(`subscription { guarded(entity: "${FERN}") { height } }`);
    expect(await nextFrame(stream, 2_000)).toBe(34);
    await host.append([op(rootClaims("ada", K2, OP, t0 + 10))]);
    expect(await nextFrame(stream, 2_000)).toBe(30);
    expect(await heightOf(pool)).toBe(30);
    await stream.return(undefined);
  });

  it("a closed pool leaves its host's dependents", async () => {
    const t0 = Date.now() - 10_000;
    const { host, pool } = await world(t0);
    const dependents = (host as unknown as { userDependents: Set<Gateway> }).userDependents;
    pool.readUsersFrom(host);
    expect(dependents.has(pool)).toBe(true);
    await pool.close();
    open.splice(open.indexOf(pool), 1);
    expect(dependents.has(pool)).toBe(false);
  });

  it("the pool's listing follows a re-point in the host", async () => {
    const t0 = Date.now() - 10_000;
    const { host, pool } = await world(t0);
    pool.readUsersFrom(host);
    const moss = observed(MOSS, "tag", "soft", t0 + 4, GARDENER_SEED);
    await pool.append([moss]);
    await pool.federate([strike(K2_SEED, moss, t0 + 5)]);
    expect((await pool.list("Guarded")).map((n) => n.entity)).toEqual([FERN, MOSS]);
    await host.append([op(rootClaims("ada", K2, OP, t0 + 10))]);
    expect((await pool.list("Guarded")).map((n) => n.entity)).toEqual([FERN]);
  });
});

describe("R6: a root claim's window opens with nothing written", () => {
  it("the host's own view and the pool's view both move at the boundary", async () => {
    const t0 = Date.now() - 10_000;
    const { host, pool } = await world(t0);
    pool.readUsersFrom(host);
    // The same shape in the host itself.
    const hostLater = observed(FERN, "height", 34, t0 + 2, GARDENER_SEED);
    await host.append([
      op(grantClaims(STORE_ENTITY, GARDENER, "write", OP, t0)),
      op(grantClaims(STORE_ENTITY, "user:ada", "write", OP, t0)),
    ]);
    await host.append([observed(FERN, "height", 30, t0 + 1, GARDENER_SEED), hostLater]);
    await host.federate([strike(K2_SEED, hostLater, t0 + 3)]);
    const poolStream = await pool.subscribe(
      `subscription { guarded(entity: "${FERN}") { height } }`,
    );
    const hostStream = await host.subscribe(
      `subscription { guarded(entity: "${FERN}") { height } }`,
    );
    expect(await nextFrame(poolStream, 2_000)).toBe(34);
    expect(await nextFrame(hostStream, 2_000)).toBe(34);
    // Signed now, valid from a moment ahead: until then ada's root stays K1.
    const opens = Date.now() + 400;
    await host.append([op({ ...rootClaims("ada", K2, OP, Date.now()), validFrom: opens })]);
    expect(await heightOf(pool)).toBe(34);
    expect(await nextFrame(poolStream, 3_000)).toBe(30);
    expect(await nextFrame(hostStream, 3_000)).toBe(30);
    expect(Date.now()).toBeGreaterThanOrEqual(opens);
    await poolStream.return(undefined);
    await hostStream.return(undefined);
  });
});
