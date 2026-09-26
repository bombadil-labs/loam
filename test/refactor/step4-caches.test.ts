// Caches that must follow validity. A claim counts only inside its own [validFrom, validUntil), so a
// boundary can change an answer with nothing written. Each case writes everything first, then moves
// only the clock (fake `Date`, no timer is fired), and reads again. A cache keyed by writes alone
// keeps serving the answer from before the boundary.
//
// Covered: the container table (the table itself, and `containerScope`, a read that depends on it)
// and the tokenless public door (`queryPublic`). Not covered here: the validity timer; these reads
// must be right at the boundary whether or not the timer has fired yet.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { negatedAt } from "../../src/gateway/negation.js";
import { publicClaims } from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "5b".repeat(32);
const OP = authorForSeed(OP_SEED);
const T = 2_000_000; // the boundary

afterEach(() => {
  vi.useRealTimers();
});

const boot = (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};

const scopeIds = (gw: Gateway, name: string): string[] =>
  gw.containerScope({ containers: [name] }).map((d) => d.id);

describe("the container table follows validity", () => {
  it("a container negated from T is in the table before T and out of it at T and after", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const gw = await boot();
    const h = observed(FERN, "height", 30, T - 200, OP_SEED);
    const decl = signClaims(
      containerClaims(
        { container: "container:timed", trust: "curated", posture: "shared", membership: HEIGHTS },
        OP,
        T - 80,
      ),
      OP_SEED,
    );
    const strike = signClaims(
      { ...makeNegationClaims(OP, T - 70, decl.id), validFrom: T },
      OP_SEED,
    );
    await gw.append([h, decl, strike]);

    vi.setSystemTime(T - 1);
    expect(gw.containers().containers.has("container:timed")).toBe(true);
    expect(scopeIds(gw, "container:timed")).toContain(h.id);

    vi.setSystemTime(T);
    expect(gw.containers().containers.has("container:timed")).toBe(false);
    expect(() => scopeIds(gw, "container:timed")).toThrow(/no surviving declaration/);

    vi.setSystemTime(T + 1);
    expect(gw.containers().containers.has("container:timed")).toBe(false);

    // Back before the boundary (a host clock step): the table answers for that time again.
    vi.setSystemTime(T - 1);
    expect(gw.containers().containers.has("container:timed")).toBe(true);
    await gw.close();
  });

  it("a declaration valid from T is out of the table before T and in it at T", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const gw = await boot();
    const h = observed(FERN, "height", 30, T - 200, OP_SEED);
    // A live bystander, declared now: it stays in the table on both sides of T.
    const bystander = signClaims(
      containerClaims(
        { container: "container:always", trust: "curated", posture: "shared", membership: HEIGHTS },
        OP,
        T - 85,
      ),
      OP_SEED,
    );
    const later = signClaims(
      {
        ...containerClaims(
          {
            container: "container:later",
            trust: "curated",
            posture: "shared",
            membership: HEIGHTS,
          },
          OP,
          T - 80,
        ),
        validFrom: T,
      },
      OP_SEED,
    );
    await gw.append([h, bystander, later]);

    vi.setSystemTime(T - 1);
    expect(gw.containers().containers.has("container:later")).toBe(false);
    expect(gw.containers().containers.has("container:always")).toBe(true);
    expect(() => scopeIds(gw, "container:later")).toThrow(/no surviving declaration/);

    vi.setSystemTime(T);
    expect(gw.containers().containers.has("container:later")).toBe(true);
    expect(gw.containers().containers.has("container:always")).toBe(true);
    expect(scopeIds(gw, "container:later")).toContain(h.id);
    await gw.close();
  });
});

describe("the public door follows validity", () => {
  it("a public declaration valid until T serves tokenless reads before T and refuses them at T", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, T - 200, OP_SEED)]);
    await gw.append([
      signClaims({ ...publicClaims(["Plant"], OP, T - 80), validUntil: T }, OP_SEED),
    ]);
    const query = `{ plant(entity: "${FERN}") { height } }`;

    vi.setSystemTime(T - 1);
    const before = await gw.queryPublic(query);
    expect((before.data as { plant: { height: number } }).plant.height).toBe(30);
    expect(gw.hasPublicSurface()).toBe(true);

    vi.setSystemTime(T);
    await expect(gw.queryPublic(query)).rejects.toThrow(/public/);
    expect(gw.hasPublicSurface()).toBe(false);
    await gw.close();
  });

  it("a public declaration valid from T refuses tokenless reads before T and serves them at T", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T - 100);
    const gw = await boot();
    await gw.append([observed(FERN, "height", 30, T - 200, OP_SEED)]);
    await gw.append([
      signClaims({ ...publicClaims(["Plant"], OP, T - 80), validFrom: T }, OP_SEED),
    ]);
    const query = `{ plant(entity: "${FERN}") { height } }`;

    vi.setSystemTime(T - 1);
    await expect(gw.queryPublic(query)).rejects.toThrow(/public/);

    vi.setSystemTime(T);
    const after = await gw.queryPublic(query);
    expect((after.data as { plant: { height: number } }).plant.height).toBe(30);
    await gw.close();
  });
});

// A CONTROL, not a gate: it passes on the base. `dropChannelCommit` (channel.ts) and
// `deriveReceiptImpl` (slate.ts) hold one negation reader across `await gw.append(...)`. That is safe
// only because the substrate's reader clears its memo after an accepted ingest. This pins that
// premise at the Loam seam, so a substrate change that broke it fails here first.
describe("a negation reader held across an append sees the append", () => {
  it("negatedAt built before a strike answers true after it", async () => {
    const gw = await boot();
    const h = observed(FERN, "height", 30, Date.now() - 1000, OP_SEED);
    await gw.append([h]);
    const negated = negatedAt(gw.reactor, gw.validityNow(), OP);
    expect(negated(h.id)).toBe(false);
    await gw.append([signClaims(makeNegationClaims(OP, Date.now() - 500, h.id), OP_SEED)]);
    expect(negated(h.id)).toBe(true);
    await gw.close();
  });
});
