import { describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Channel } from "../../src/gateway/channel.js";
import { eraseClaims } from "../../src/gateway/erase-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, SURVEYOR, SURVEYOR_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, garden, governedBootstrap } from "./fixtures.js";
import { assertClosureDoesNotLeak, assertPreservesSuppression, retraction } from "./narrowing.js";

vi.setConfig({ testTimeout: 20_000 });

const KEEPER_SEED = "c3".repeat(32);
const KEEPER = authorForSeed(KEEPER_SEED);
const FORGOTTEN = "a-reader-must-not-outlive-the-cut";

const HEIGHTS = {
  op: "select",
  pred: { hasPointer: { context: { exact: "height" } } },
  in: "input",
};
const WATCHED = {
  op: "union",
  left: { op: "select", pred: { hasPointer: { context: { exact: "tag" } } }, in: "input" },
  right: {
    op: "select",
    pred: { match: { field: "author", cmp: "eq", const: KEEPER } },
    in: "input",
  },
};
const SURVEYORS = {
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: SURVEYOR } },
  in: "input",
};

const SUBSCRIPTION = `subscription {
  plant(entity: "${FERN}") { _hex tag }
}`;

async function keeperStore(): Promise<{ gw: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
  await gw.append(governedBootstrap(KEEPER_SEED));
  await gw.append(garden);
  gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
  return { gw, backend };
}

async function promptly<T>(p: Promise<T>): Promise<T | "still parked"> {
  return Promise.race([
    p,
    new Promise<"still parked">((resolve) => {
      setTimeout(() => resolve("still parked"), 1000).unref?.();
    }),
  ]);
}

const idsOf = (frame: unknown): string[] => ((frame ?? []) as Delta[]).map((d) => d.id);

async function readerOf(frame: readonly Delta[]): Promise<Gateway> {
  const dest = await Gateway.open(new MemoryBackend(), {});
  await dest.federate(frame, { admit: () => true });
  dest.register(PLANT, PLANT_POLICY, [FERN], undefined, [...PLANT_WRITABLE]);
  return dest;
}

async function heightSeenBy(dest: Gateway): Promise<unknown> {
  const res = await dest.query(`{ Plant(entity: "${FERN}") { height } }`);
  return (res.data?.Plant as { height?: unknown } | undefined)?.height ?? null;
}

describe("§11 — a live membership watch does not outlive the cut", () => {
  it("a reader parked across the cut is handed no erased bytes, and the stream ends", async () => {
    const { gw, backend } = await keeperStore();
    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]);

    const stream = gw.watch(WATCHED);
    const first = await stream.next();
    expect(idsOf(first.value)).toContain(secret.id);
    expect(gw.channels.has(stream)).toBe(true);

    const parked = stream.next();
    await gw.erase(secret.id, { reason: "a watcher is a tier too" });

    const woken = await promptly(parked);
    expect(woken).not.toBe("still parked");
    expect(woken === "still parked" ? undefined : woken.done).toBe(false);
    const served = woken === "still parked" ? undefined : woken.value;
    expect(Array.isArray(served)).toBe(true);
    expect(idsOf(served)).not.toContain(secret.id);
    expect(JSON.stringify(served ?? [])).not.toContain(FORGOTTEN);

    const after = await promptly(stream.next());
    expect(after).not.toBe("still parked");
    expect(after === "still parked" ? undefined : after.done).toBe(true);
    expect(gw.channels.has(stream)).toBe(false);

    const reopened = gw.watch(WATCHED);
    const fresh = await reopened.next();
    expect(idsOf(fresh.value)).not.toContain(secret.id);
    expect(JSON.stringify(fresh.value ?? [])).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });
});

describe("§11 — an undrained frame does not survive the cut", () => {
  it("a slow subscriber drains no pre-cut view once the erase has closed its stream", async () => {
    const { gw, backend } = await keeperStore();
    const witness = await gw.subscribe(SUBSCRIPTION);
    const slow = await gw.subscribe(SUBSCRIPTION);
    await witness.next();
    await slow.next();

    const secret = observed(FERN, "tag", FORGOTTEN, 3000, GARDENER_SEED);
    await gw.append([secret]);
    const witnessed = await promptly(witness.next());
    expect(witnessed).not.toBe("still parked");
    expect(JSON.stringify(witnessed === "still parked" ? {} : witnessed.value)).toContain(
      FORGOTTEN,
    );
    await witness.return?.(undefined);
    await gw.erase(secret.id, { reason: "an undrained patch is a tier too" });

    const after = await promptly(slow.next());
    expect(after).not.toBe("still parked");
    const payload: unknown = after === "still parked" ? undefined : after.value;
    expect(JSON.stringify(payload ?? {})).not.toContain(FORGOTTEN);
    expect(after === "still parked" ? undefined : after.done).toBe(true);

    const reopened = await gw.subscribe(SUBSCRIPTION);
    const snapshot = await reopened.next();
    expect(JSON.stringify(snapshot.value ?? {})).not.toContain(FORGOTTEN);
    await reopened.return?.(undefined);
    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(FORGOTTEN);
    await gw.close();
  });

  it("a channel that has been left forgets what it was holding", async () => {
    const ch = new Channel<string>();
    ch.push(FORGOTTEN);
    await ch.return();
    const after = await ch.next();
    expect(after.done).toBe(true);
    expect(JSON.stringify(after)).not.toContain(FORGOTTEN);
  });
});

describe("H1 — a membership frame carries what struck its members", () => {
  it("a context-scoped Term cannot select a strike, so the frame must carry the closure", async () => {
    const { gw } = await keeperStore();
    const struck = garden[1]!;
    await gw.append([retraction(struck.id, SURVEYOR, SURVEYOR_SEED, 2500)]);

    const stream = gw.watch(HEIGHTS);
    const frame = (await stream.next()).value as Delta[];
    const dest = await readerOf(frame);
    assertPreservesSuppression({
      what: "watch frame (context-scoped Term over a retracted claim)",
      source: gw,
      destination: dest,
      struckClaim: struck.id,
    });
    expect(await heightSeenBy(dest)).not.toBe(34);

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });

  it("the closure runs forward only: a strike never drags its excluded target in", async () => {
    const { gw } = await keeperStore();
    const tag = garden[2]!;
    const tagStrike = retraction(tag.id, KEEPER, KEEPER_SEED, 2600);
    await gw.append([tagStrike]);

    const stream = gw.watch(HEIGHTS);
    const frame = (await stream.next()).value as Delta[];
    const dest = await readerOf(frame);
    assertClosureDoesNotLeak({
      what: "watch frame",
      destination: dest,
      excludedTarget: tag.id,
      itsRetraction: tagStrike.id,
    });

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });

  it("withholding a condemned strike withholds its target too, rather than reviving it", async () => {
    const { gw } = await keeperStore();
    const struck = garden[1]!;
    const strike = retraction(struck.id, SURVEYOR, SURVEYOR_SEED, 2500);
    await gw.append([strike]);
    await gw.append([
      signClaims(
        eraseClaims(strike.id, SURVEYOR, KEEPER, 4000, "the strike is condemned, not the claim"),
        KEEPER_SEED,
      ),
    ]);

    const stream = gw.watch(SURVEYORS);
    const frame = (await stream.next()).value as Delta[];
    expect(idsOf(frame)).not.toContain(strike.id);
    expect(idsOf(frame)).not.toContain(struck.id);
    const dest = await readerOf(frame);
    expect(await heightSeenBy(dest)).not.toBe(34);

    await stream.return?.(undefined);
    await dest.close();
    await gw.close();
  });
});

describe("§11 — erased law stops being SERVED, not just stops being ground", () => {
  it("re-seating re-derives the store's registrations, so an erased lens leaves the surface", async () => {
    const SECRET_LAW = "export default (bucket) => bucket.length; // law-with-a-subject-in-it";
    const backend = new MemoryBackend();
    const gw = await Gateway.open(backend, { seed: KEEPER_SEED });
    await gw.append(governedBootstrap(KEEPER_SEED));
    await gw.append(garden);
    const published = await gw.publishRegistration(
      PLANT,
      PLANT_POLICY,
      [FERN],
      undefined,
      undefined,
      undefined,
      [...PLANT_WRITABLE],
      { height: { rung: "a", type: "number", code: SECRET_LAW } },
    );
    expect(published.bound).toBe(true);
    expect(JSON.stringify(gw.surface()?.registered)).toContain("law-with-a-subject-in-it");

    const carriers = [...gw.reactor.snapshot()]
      .filter((d) => JSON.stringify(d.claims).includes("law-with-a-subject-in-it"))
      .map((d) => d.id);
    expect(carriers.length).toBeGreaterThan(0);
    for (const id of carriers) await gw.erase(id, { reason: "law is bytes too" });

    expect(JSON.stringify(await backend.deltasSince(new Set()))).not.toContain(
      "law-with-a-subject-in-it",
    );
    expect(JSON.stringify(gw.surface()?.registered ?? [])).not.toContain(
      "law-with-a-subject-in-it",
    );
    await gw.close();
  });
});

describe("§11 — a negated erasure does not return a member to the live frame", () => {
  it("the member stays withheld after its erasure is negated", async () => {
    const { gw } = await keeperStore();
    const held = garden[1]!;
    const erasure = signClaims(
      eraseClaims(held.id, SURVEYOR, KEEPER, 4000, "condemned, then negated"),
      KEEPER_SEED,
    );
    await gw.append([erasure]);

    const stream = gw.watch(HEIGHTS);
    const condemned = (await stream.next()).value as Delta[];
    expect(idsOf(condemned)).not.toContain(held.id);

    await gw.append([retraction(erasure.id, KEEPER, KEEPER_SEED, 4100)]);
    expect(gw.reactor.get(held.id)).toBeDefined();
    const after = await promptly(stream.next());
    expect(after).toBe("still parked");

    await stream.return?.(undefined);
    await gw.close();
  });
});
