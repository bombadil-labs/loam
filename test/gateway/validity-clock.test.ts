// The store's read time is the wall clock. A claim's `timestamp` orders it among its author's
// claims; it never moves the moment a validity read looks at. Each case asserts both levels: the
// times on the signed delta, and what a query reads. Each case also names a bystander: a claim that
// ends soon must still be read, and a claim that starts soon must not be read yet.
//
// Not covered here: a peer's far-future timestamp arriving through a channel. That path lands
// through the same ingest, and `noteAuthorTime` is the one place it touches the clocks.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { boundGroundFor } from "../../src/gateway/reads.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "7c".repeat(32);
const OP = authorForSeed(OP_SEED);
const T0 = 1_000_000_000;
const HOUR = 3_600_000;
const TEN_MIN = 600_000;

const genesis = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

// One operator-signed claim on the fern, with every time chosen by the caller.
const claim = (
  context: string,
  value: string | number,
  times: { timestamp: number; validFrom: number; validUntil?: number },
): Delta =>
  signClaims(
    {
      ...times,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    OP_SEED,
  );

type Fern = { plant: { height: number | null; tag: string[] } };
const read = async (gw: Gateway): Promise<Fern["plant"]> =>
  ((await gw.query(`{ plant(entity: "${FERN}") { height tag } }`)).data as Fern).plant;
const mutate = async (gw: Gateway, height: number): Promise<void> => {
  const res = await gw.query(`mutation { plant(entity: "${FERN}", height: ${height}) { height } }`);
  expect(res.errors).toBeUndefined();
};
// The height deltas this gateway holds, newest signed time last.
const heights = (gw: Gateway): Delta[] =>
  [...gw.reactor.snapshot()]
    .filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === "height",
      ),
    )
    .sort((a, b) => a.claims.timestamp - b.claims.timestamp);
const valueOf = (d: Delta): unknown =>
  d.claims.pointers.find((p) => p.role === "value" && p.target.kind === "primitive")?.target;

// The two bystanders: one ends ten minutes after T0, one starts ten minutes after T0.
const bystanders = (): Delta[] => [
  claim("tag", "ends-soon", { timestamp: T0, validFrom: T0, validUntil: T0 + TEN_MIN }),
  claim("tag", "starts-soon", { timestamp: T0, validFrom: T0 + TEN_MIN }),
];

afterEach(() => {
  vi.useRealTimers();
});

describe("a signed future timestamp does not move the store's read time", () => {
  it("a future-stamped claim plus one ordinary write leaves every reader at the wall clock, before and after a reopen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const backend = new MemoryBackend();
    const gw = await Gateway.boot(backend, genesis());
    await gw.append([
      ...bystanders(),
      claim("height", 99, { timestamp: T0 + HOUR, validFrom: T0 }),
    ]);
    await mutate(gw, 7);

    expect(gw.validityNow()).toBe(T0);
    expect((await read(gw)).tag).toEqual(["ends-soon"]);

    // A second process over the same store: it reads the held future timestamp at open.
    const reopened = await Gateway.open(backend, { seed: OP_SEED });
    expect(reopened.validityNow()).toBe(T0);
    expect((await read(reopened)).tag).toEqual(["ends-soon"]);
    await mutate(reopened, 8);
    expect(reopened.validityNow()).toBe(T0);
    expect((await read(reopened)).tag).toEqual(["ends-soon"]);
    await reopened.close();
    await gw.close();
  });

  it("fifty ordinary writes at a frozen wall clock leave the read time at the wall clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    await gw.append([
      claim("tag", "ends-at-10", { timestamp: T0, validFrom: T0, validUntil: T0 + 10 }),
      claim("tag", "starts-at-10", { timestamp: T0, validFrom: T0 + 10 }),
    ]);
    for (let i = 0; i < 50; i += 1) await mutate(gw, i);

    expect(gw.validityNow()).toBe(T0);
    expect(await read(gw)).toEqual({ height: 49, tag: ["ends-at-10"] });
    // The writes still sort in the order they were made.
    const held = heights(gw);
    expect(held).toHaveLength(50);
    expect(held.map((d) => valueOf(d))).toEqual(
      held.map((_, i) => ({ kind: "primitive", value: i })),
    );
    await gw.close();
  });
});

describe("the author's claims still sort in the order they were made", () => {
  it("the next write sorts after a held future timestamp, and is valid from the wall clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    await gw.append([
      ...bystanders(),
      claim("height", 99, { timestamp: T0 + HOUR, validFrom: T0 }),
    ]);
    await mutate(gw, 7);

    // Delta level: the write's two times.
    const written = heights(gw).at(-1)!;
    expect(valueOf(written)).toEqual({ kind: "primitive", value: 7 });
    expect(written.claims.timestamp).toBeGreaterThan(T0 + HOUR);
    expect(written.claims.validFrom).toBe(T0);
    // The next stamp for the same author sorts after that write, and is valid now.
    const next = gw.stamp();
    expect(next.timestamp).toBeGreaterThan(written.claims.timestamp);
    expect(next.validFrom).toBe(T0);

    // Object level: the write wins its pick and is read at once, beside the bystanders.
    expect(await read(gw)).toEqual({ height: 7, tag: ["ends-soon"] });
    await gw.close();
  });

  it("after a restart with the clock set back, a new write sorts after the old one and is read at once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const backend = new MemoryBackend();
    vi.setSystemTime(T0 + 10_000);
    const first = await Gateway.boot(backend, genesis());
    await mutate(first, 1);
    const before = heights(first).at(-1)!;

    vi.setSystemTime(T0); // the host clock steps back before the process restarts
    const second = await Gateway.open(backend, { seed: OP_SEED });
    await mutate(second, 2);
    const after = heights(second).at(-1)!;
    expect(valueOf(after)).toEqual({ kind: "primitive", value: 2 });
    expect(after.claims.timestamp).toBeGreaterThan(before.claims.timestamp);
    expect(after.claims.validFrom).toBe(T0);
    expect((await read(second)).height).toBe(2);

    // Once the wall clock passes the old write, both are valid, and the order decides.
    vi.setSystemTime(T0 + 11_000);
    expect((await read(second)).height).toBe(2);
    await second.close();
    await first.close();
  });

  it("a held timestamp past the safe-integer range does not hide a safe one, and writes still succeed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(new MemoryBackend(), genesis());
    await gw.append([
      claim("tag", "safe-future", { timestamp: T0 + 1_000, validFrom: T0 }),
      claim("tag", "absurd", { timestamp: 1e300, validFrom: T0 }),
    ]);

    const s = gw.stamp();
    expect(Number.isFinite(s.timestamp)).toBe(true);
    expect(s.timestamp).toBeGreaterThan(T0 + 1_000);
    expect(s.timestamp).toBeGreaterThanOrEqual(s.validFrom);
    expect(s.validFrom).toBe(T0);

    await mutate(gw, 5);
    const written = heights(gw).at(-1)!;
    expect(written.claims.timestamp).toBeGreaterThan(s.timestamp);
    expect(Number.isSafeInteger(written.claims.timestamp)).toBe(true);
    expect(gw.validityNow()).toBe(T0);
    expect((await read(gw)).height).toBe(5);
    await gw.close();
  });
});

// The inbox's seeding cut is a signed time taken from the operator's ordering clock. A key's own
// held claims never raise it: if they did, a key that once signed a far-future claim would stop
// seeding what it writes after the binding. Deliberately not asserted: the pre-binding future claim
// itself, whose timestamp is past the cut and so seeds. A cut on arrival would close that;
// `refactor/PLAN.md` step 6 names it.
describe("a connection's inbox cut does not follow the key's held timestamps", () => {
  it("a root claim the key writes after binding seeds its inbox, though it holds one an hour ahead", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const CONN_SEED = "e5".repeat(32);
    const conn = authorForSeed(CONN_SEED);
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({
        operatorSeed: OP_SEED,
        registrations: [
          {
            hyperschema: PLANT,
            schema: PLANT_POLICY,
            roots: [FERN],
            writable: [...PLANT_WRITABLE],
          },
        ],
      }),
    );
    const op = gw.operatorAuthor!;
    await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", op, T0), OP_SEED)]);
    await gw.append([signClaims(grantClaims(STORE_ENTITY, conn, "write", op, T0), OP_SEED)]);
    const ahead = signClaims(
      {
        ...observed(FERN, "tag", "signed ahead", 0, CONN_SEED).claims,
        timestamp: T0 + HOUR,
        validFrom: T0,
      },
      CONN_SEED,
    );
    await gw.append([ahead]);
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: "home:ada",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
              in: "input",
            },
          },
          op,
          T0,
        ),
        OP_SEED,
      ),
    ]);
    const inbox = (
      await gw.bindConnection({
        container: "home:ada",
        connectionKey: conn,
        ownerSeed: GARDENER_SEED,
      })
    ).entity!;
    const binding = { container: "home:ada", inbox };

    vi.setSystemTime(T0 + 5);
    const fresh = observed(FERN, "height", 12, T0 + 5, CONN_SEED); // written in the parent
    await gw.append([fresh]);
    await gw.connectionInboxes.get(inbox)!.reseed(); // seeding runs at open and on a re-pulse
    expect(gw.poolForBinding(binding).reactor.get(fresh.id)).toBeDefined(); // seeded, at the bytes
    expect(boundGroundFor(gw, binding, gw.validityNow()).has(fresh.id)).toBe(true);
    await gw.close();
  });
});

describe("one author's ordering floor does not lift another's", () => {
  it("B stamps near the clock after A stamps above A's held future time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    const A = authorForSeed("a9".repeat(32));
    const B = authorForSeed("b9".repeat(32));
    await gw.append([signClaims(grantClaims(STORE_ENTITY, A, "write", OP, T0), OP_SEED)]);
    const held = signClaims(
      {
        ...observed(FERN, "tag", "ahead", 0, "a9".repeat(32)).claims,
        timestamp: T0 + HOUR,
        validFrom: T0,
      },
      "a9".repeat(32),
    );
    await gw.append([held]);

    const a = gw.stamp(A);
    const b = gw.stamp(B);
    expect(a.timestamp).toBeGreaterThan(T0 + HOUR); // A stays above its own held claim
    expect(b.timestamp).toBeLessThan(T0 + 1_000); // B follows the clock, not A's floor
    expect([a.validFrom, b.validFrom]).toEqual([T0, T0]);
    await gw.close();
  });
});

describe("strict order ends cleanly at the top of the safe range", () => {
  it("two stamps after a held MAX_SAFE_INTEGER - 1 never repeat", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
    const gw = await Gateway.boot(
      new MemoryBackend(),
      assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
    );
    const A_SEED = "a8".repeat(32);
    const A = authorForSeed(A_SEED);
    await gw.append([signClaims(grantClaims(STORE_ENTITY, A, "write", OP, T0), OP_SEED)]);
    const top = Number.MAX_SAFE_INTEGER - 1;
    await gw.append([
      signClaims(
        { ...observed(FERN, "tag", "at the top", 0, A_SEED).claims, timestamp: top, validFrom: T0 },
        A_SEED,
      ),
    ]);

    const first = gw.stamp(A);
    const second = gw.stamp(A);
    expect(first.timestamp).toBe(Number.MAX_SAFE_INTEGER); // still above the held claim
    expect(second.timestamp).not.toBe(first.timestamp); // never the same stamp twice
    expect(Number.isSafeInteger(second.timestamp)).toBe(true);
    expect(second.timestamp).toBeLessThan(first.timestamp); // strict order has ended, as documented
    await gw.close();
  });
});
