// Step 13's contract: trust is data. What a store admits at federation is CONFIGURATION, and
// configuration — like everything else — is a derived view over deltas that are always
// updating. One operator-authored policy delta at `loam:trust` declares the mode (open /
// roster / closed); the next pull obeys it; a roster edit is a delta, not a restart. And with
// 0.2.0's inView, the SAME roster reaches eval-side masks — admission and resolution share one
// live source of truth.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, makeNegationClaims, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { pullFrom } from "../../src/federation/pull.js";
import {
  TRUST_ENTITY,
  readTrustPolicy,
  trustClaims,
  trustRosterPred,
} from "../../src/gateway/trust.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";

vi.setConfig({ testTimeout: 15000 });

const OP_A = "0a".repeat(32);
const OP_B = "0b".repeat(32);
const MALLORY_SEED = "ee".repeat(32);
const MALLORY = authorForSeed(MALLORY_SEED);

const handles: ServerHandle[] = [];
const gateways: Gateway[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) await h.close();
  for (const g of gateways.splice(0)) await g.close().catch(() => {});
});

// A served instance holding the gardener's height claim AND a Mallory-authored claim — the
// mixed offer every admission test pulls from.
async function mixedSource(): Promise<{ url: string; token: string }> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OP_A });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", authorForSeed(OP_A), 1), OP_A),
  ]);
  await gateway.append([observed(FERN, "height", 42, 1000, GARDENER_SEED)]);
  await gateway.federate([observed(FERN, "height", 99, 2000, MALLORY_SEED)]); // open by default
  gateways.push(gateway);
  const handle = await serve({
    mounts: { default: gateway },
    tokens: { "tok-a": { operator: true } },
    port: 0,
  });
  handles.push(handle);
  return { url: `${handle.url}/default`, token: "tok-a" };
}

async function puller(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OP_B });
  gateway.register(PLANT, PLANT_POLICY, [FERN]);
  gateways.push(gateway);
  return gateway;
}

const OPERATOR_B = authorForSeed(OP_B);
const declare = (gateway: Gateway, mode: "open" | "roster" | "closed", roster: string[] = []) =>
  gateway.append([signClaims(trustClaims(mode, roster, OPERATOR_B, Date.now()), OP_B)]);
const holds = (gateway: Gateway, author: string): boolean =>
  [...gateway.reactor.snapshot()].some((d) => d.claims.author === author);

describe("the trust policy: one delta at loam:trust, latest lawful word wins", () => {
  it("no surviving policy means OPEN — union is the substrate's nature", async () => {
    const b = await puller();
    expect(readTrustPolicy(b.reactor, OPERATOR_B).mode).toBe("open");
    const a = await mixedSource();
    const report = await pullFrom(b, a.url, a.token);
    expect(report.accepted).toBeGreaterThan(0);
    expect(holds(b, MALLORY)).toBe(true); // open admits the stranger too
  });

  it("roster mode admits exactly the listed authors (and the operator)", async () => {
    const b = await puller();
    await declare(b, "roster", [GARDENER]);
    const a = await mixedSource();
    await pullFrom(b, a.url, a.token);
    expect(holds(b, GARDENER)).toBe(true);
    expect(holds(b, MALLORY)).toBe(false); // offered, refused at the door
  });

  it("closed admits nothing", async () => {
    const b = await puller();
    await declare(b, "closed");
    const a = await mixedSource();
    const report = await pullFrom(b, a.url, a.token);
    expect(report.accepted).toBe(0);
  });

  it("LIVE: one roster delta flips what the very next pull admits — no restart", async () => {
    const b = await puller();
    await declare(b, "roster", [GARDENER]);
    const a = await mixedSource();
    await pullFrom(b, a.url, a.token);
    expect(holds(b, MALLORY)).toBe(false);

    await declare(b, "roster", [GARDENER, MALLORY]); // the config is a delta
    await pullFrom(b, a.url, a.token);
    expect(holds(b, MALLORY)).toBe(true); // the backlog crosses on the next pulse
  });

  it("an explicit admit override wins over the store policy", async () => {
    const b = await puller();
    await declare(b, "closed");
    const a = await mixedSource();
    const report = await pullFrom(b, a.url, a.token, { admit: () => true });
    expect(report.accepted).toBeGreaterThan(0);
  });

  it("a stranger's strike is refused at a rostered door before any mask has to care", async () => {
    const b = await puller();
    await declare(b, "roster", [GARDENER]);
    const honest = observed(FERN, "height", 42, 1000, GARDENER_SEED);
    await b.federate([honest]); // gardener is rostered: lands
    const strike = signClaims(makeNegationClaims(MALLORY, 3000, honest.id), MALLORY_SEED);
    const report = await b.federate([strike]);
    expect(report.accepted).toBe(0); // the strike never entered the store at all
    const read = await b.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((read.data as { plant: { height: number } }).plant.height).toBe(42);
  });

  it("a foreign trust declaration binds nothing: Mallory cannot close someone else's door", async () => {
    const b = await puller();
    await declare(b, "roster", [GARDENER]);
    // Mallory forges a policy delta declaring B open — it must be admitted per the CURRENT
    // roster? No: she is unrostered, so it never even lands; and even hand-landed it would
    // not bind (lawful reads). Prove the stronger half by injecting past the door:
    const forged = signClaims(trustClaims("open", [], MALLORY, Date.now() + 1), MALLORY_SEED);
    await b.federate([forged], { admit: () => true }); // force it into the store
    const policy = readTrustPolicy(b.reactor, OPERATOR_B);
    expect(policy.mode).toBe("roster"); // the operator's word stands
    expect(policy.roster.has(MALLORY)).toBe(false);
  });

  it("a malformed declaration is MALFORMED LAW, refused at append for everyone", async () => {
    // The inView lens cannot validate shape, so the door must: a declaration with a bogus
    // mode (or duplicate modes, or a non-string admit-author) never enters a governed store —
    // which is exactly what keeps door and lens reading identical ground.
    const b = await puller();
    await declare(b, "roster", [GARDENER]);
    const bogusMode = signClaims(
      {
        timestamp: Date.now() + 10,
        author: OPERATOR_B,
        pointers: [
          {
            role: "declares",
            target: { kind: "entity", entity: { id: TRUST_ENTITY, context: "loam.trust" } },
          },
          { role: "mode", target: { kind: "primitive", value: "ajar" } }, // no such mode
          { role: "admit-author", target: { kind: "primitive", value: MALLORY } }, // the smuggle
        ],
      },
      OP_B,
    );
    await expect(b.append([bogusMode])).rejects.toThrow(/malformed law/);
    const twoModes = signClaims(
      {
        timestamp: Date.now() + 11,
        author: OPERATOR_B,
        pointers: [
          {
            role: "declares",
            target: { kind: "entity", entity: { id: TRUST_ENTITY, context: "loam.trust" } },
          },
          { role: "mode", target: { kind: "primitive", value: "open" } },
          { role: "mode", target: { kind: "primitive", value: "closed" } },
        ],
      },
      OP_B,
    );
    await expect(b.append([twoModes])).rejects.toThrow(/malformed law/);
    const policy = readTrustPolicy(b.reactor, OPERATOR_B);
    expect(policy.mode).toBe("roster"); // the lawful word survives
    expect(policy.roster.has(MALLORY)).toBe(false); // and the smuggle never reached the roster
  });

  it("removal is negation: strike the admitting declaration and the door closes to them", async () => {
    const b = await puller();
    const admitting = signClaims(
      trustClaims("roster", [GARDENER, MALLORY], OPERATOR_B, Date.now()),
      OP_B,
    );
    await b.append([admitting]);
    const a = await mixedSource();
    await pullFrom(b, a.url, a.token);
    expect(holds(b, MALLORY)).toBe(true); // admitted while rostered

    // remove Mallory: a FRESH declaration only adds, so the operator strikes the old one and
    // declares the roster she should have had — negation is the eraser, here as everywhere
    await b.append([
      signClaims(makeNegationClaims(OPERATOR_B, Date.now() + 1, admitting.id), OP_B),
      signClaims(trustClaims("roster", [GARDENER], OPERATOR_B, Date.now() + 2), OP_B),
    ]);
    const policy = readTrustPolicy(b.reactor, OPERATOR_B);
    expect(policy.roster.has(MALLORY)).toBe(false); // the door agrees
    expect(policy.roster.has(GARDENER)).toBe(true);
    // her already-landed deltas remain (nothing is deleted) — but the door refuses NEW ones
    const fresh = observed(FERN, "note", "late knock", Date.now() + 3, MALLORY_SEED);
    const report = await b.federate([fresh]);
    expect(report.accepted).toBe(0);
  });

  it("closed, then open again: two declarations, two postures, no restart", async () => {
    const b = await puller();
    await declare(b, "closed");
    const a = await mixedSource();
    expect((await pullFrom(b, a.url, a.token)).accepted).toBe(0);
    await declare(b, "open");
    expect((await pullFrom(b, a.url, a.token)).accepted).toBeGreaterThan(0);
  });

  it("an UNGOVERNED store ignores trust declarations and stays open — no stranger lockout", async () => {
    const free = await Gateway.open(new MemoryBackend()); // no operator, no lawful voice
    gateways.push(free);
    // a stranger's max-timestamp "closed" arrives by federation; it must bind nothing
    await free.federate([
      signClaims(trustClaims("closed", [], MALLORY, Number.MAX_SAFE_INTEGER), MALLORY_SEED),
    ]);
    expect(readTrustPolicy(free.reactor).mode).toBe("open");
    const report = await free.federate([observed(FERN, "height", 7, 1000, GARDENER_SEED)]);
    expect(report.accepted).toBe(1); // the door never closed
  });
});

describe("one source of truth: the roster reaches eval-side masks via inView", () => {
  it("a rostered author's data strike binds under the roster lens; a stranger's does not", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OP_B });
    gateways.push(gateway);
    await gateway.append([
      signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OPERATOR_B, 1), OP_B),
    ]);
    await declare(gateway, "roster", [GARDENER]);
    // a schema whose negation mask trusts THE ROSTER — the same deltas admission reads
    gateway.register(
      {
        name: "Rostered",
        alg: 1,
        body: parseTerm({
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: {
              op: "mask",
              policy: { trust: trustRosterPred(OPERATOR_B) },
              in: "input",
            },
          },
        }),
      },
      PLANT_POLICY,
      [FERN],
    );
    const first = observed(FERN, "height", 30, 1000, GARDENER_SEED);
    const second = observed(FERN, "height", 34, 2000, GARDENER_SEED);
    await gateway.append([first, second]);

    // the stranger's strike: forced into the store, ignored by the roster lens
    await gateway.federate(
      [signClaims(makeNegationClaims(MALLORY, 3000, second.id), MALLORY_SEED)],
      { admit: () => true },
    );
    const afterStranger = await gateway.query(`{ plant: rostered(entity: "${FERN}") { height } }`);
    expect((afterStranger.data as { plant: { height: number } }).plant.height).toBe(34);

    // the ROSTERED author's strike: the same lens honors it
    await gateway.append([
      signClaims(makeNegationClaims(GARDENER, 4000, second.id), GARDENER_SEED),
    ]);
    const afterRostered = await gateway.query(`{ plant: rostered(entity: "${FERN}") { height } }`);
    expect((afterRostered.data as { plant: { height: number } }).plant.height).toBe(30);
  });
});
