// T288 P3 regressions: local protection walks each finite lineage once, and protected channel
// identity is derived from effective referenced history and the container reader's declaration.
import { afterEach, describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  signClaims,
  type Claims,
  type Delta,
  type Reactor,
} from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import {
  CTX_CONTAINER,
  CTX_CONTAINER_EXCLUDED,
  containerClaims,
  exclusionClaims,
} from "../../src/gateway/container.js";
import { channelRecordClaims } from "../../src/federation/channel.js";
import {
  currentPoolDeclaration,
  localChannelEvidence,
  protectedIngressIds,
} from "../../src/federation/local-channel-events.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const FROM = "https://peer.example/default";
const EVENT = "loam.local.channel.event";
const homes: Gateway[] = [];

afterEach(async () => {
  for (const gw of homes.splice(0)) await gw.close();
});

const entity = (role: string, id: string, context: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const primitive = (role: string, value: string | number): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value },
});
const ref = (role: string, id: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "delta", deltaRef: { delta: id } },
});

function openLiteral(
  name: string,
  statusAtOpen: string,
  poolDeclaration: string,
  timestamp: number,
): Claims {
  return {
    author: OP,
    timestamp,
    pointers: [
      entity("event", `channel:${name}`, EVENT),
      primitive("version", 1),
      primitive("action", "open"),
      entity("parent-container", "friends", EVENT),
      primitive("nonce", "34".repeat(32)),
      primitive("into", "friends"),
      primitive("prefix", "peer"),
      primitive("from", FROM),
      primitive("opener-kind", "root"),
      ref("status-at-open", statusAtOpen),
      ref("pool-declaration", poolDeclaration),
    ],
  };
}

async function home(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    { channelBackend: () => new MemoryBackend() },
  );
  homes.push(gw);
  return gw;
}

async function channelFixture(prefix = "peer") {
  const gw = await home();
  const offering: Delta[] = [];
  const channel = await gw.openChannel({
    into: "friends",
    prefix,
    from: FROM,
    source: { pull: () => Promise.resolve([...offering]) },
  });
  return { gw, channel, offering };
}

async function rawRestore(gw: Gateway, deltas: readonly Delta[]): Promise<void> {
  await gw.backend.append(deltas);
  for (const delta of deltas) expect(gw.reactor.ingest(delta).status).not.toBe("rejected");
}

describe("T288 protected ingress closure has bounded linear work", () => {
  it("finds a reverse-ordered transitive lineage once and excludes unrelated data", () => {
    const root = signClaims(
      {
        author: OP,
        timestamp: 100,
        pointers: [entity("anything", "channel:bounded", EVENT)],
      },
      SEED,
    );
    const lineage: Delta[] = [root];
    for (let index = 1; index <= 20; index += 1) {
      lineage.push(signClaims(makeNegationClaims(OP, 100 + index, lineage[index - 1]!.id), SEED));
    }
    const unrelated = signClaims(
      {
        author: OP,
        timestamp: 200,
        pointers: [primitive("ordinary", "bystander")],
      },
      SEED,
    );
    const ordered = [...lineage.slice(1).reverse(), root, unrelated];
    let pointerReads = 0;
    const watched = ordered.map((delta) => {
      const claims: Claims = {
        author: delta.claims.author,
        timestamp: delta.claims.timestamp,
        get pointers() {
          pointerReads += 1;
          return delta.claims.pointers;
        },
      };
      return { ...delta, claims };
    });
    // An empty ground: the protected set sweeps the arrival log once, then reads only the batch.
    const empty = { snapshot: () => [], arrivalLog: () => [] } as unknown as Reactor;

    const protectedIds = protectedIngressIds(empty, watched);

    expect([...protectedIds].sort()).toEqual(lineage.map((delta) => delta.id).sort());
    expect(protectedIds.has(unrelated.id)).toBe(false);
    expect(ordered).toHaveLength(22);
    expect(pointerReads).toBeLessThanOrEqual(ordered.length * 5);
  });
});

describe("T288 historical openings remain part of effective evidence validation", () => {
  it.each([
    ["valid", "open"],
    ["missing-status", "unavailable"],
    ["status-fields", "unavailable"],
    ["declaration-fields", "unavailable"],
  ] as const)("%s historical references project as %s", async (kind, expectedState) => {
    const { gw, channel } = await channelFixture();
    const current = localChannelEvidence(gw, channel.name);
    expect(current.state).toBe("open");
    if (current.state !== "open") throw new Error("fixture requires a current protected opening");
    const currentDeclaration = gw.reactor.get(current.opening.poolDeclaration)!;
    const currentStatus = gw.reactor.get(current.opening.statusAtOpen)!;
    const historicalTimestamp = Math.max(
      0,
      Math.min(currentDeclaration.claims.timestamp, currentStatus.claims.timestamp) - 10,
    );
    expect(historicalTimestamp).toBeLessThan(currentDeclaration.claims.timestamp);
    expect(historicalTimestamp).toBeLessThan(currentStatus.claims.timestamp);

    const historicalDeclaration = signClaims(
      containerClaims(
        {
          container: channel.name,
          trust: "untrusted",
          posture: "separate",
          inboxOf: kind === "declaration-fields" ? "elsewhere" : "friends",
        },
        OP,
        historicalTimestamp,
      ),
      SEED,
    );
    const historicalStatus = signClaims(
      channelRecordClaims(
        {
          name: channel.name,
          into: "friends",
          prefix: kind === "status-fields" ? "other-peer" : "peer",
          from: FROM,
          receiving: true,
          blessing: true,
          lastSyncedAt: 0,
          consecutiveFailures: 0,
          unattested: [],
          unreadable: [],
        },
        OP,
        historicalTimestamp,
      ),
      SEED,
    );
    const historicalOpen = signClaims(
      openLiteral(
        channel.name,
        historicalStatus.id,
        historicalDeclaration.id,
        historicalTimestamp + 1,
      ),
      SEED,
    );
    const restored = [
      historicalDeclaration,
      ...(kind === "missing-status" ? [] : [historicalStatus]),
      historicalOpen,
    ];
    await rawRestore(gw, restored);

    expect(historicalDeclaration.id).not.toBe(current.opening.poolDeclaration);
    expect(currentPoolDeclaration(gw, channel.name)).toBe(current.opening.poolDeclaration);
    expect(localChannelEvidence(gw, channel.name).state).toBe(expectedState);
  });
});

describe("T288 channel declaration identity follows container resolution", () => {
  it.each([
    ["protected", "peer"],
    ["legacy", ""],
  ] as const)(
    "a later malformed same-name row cannot replace a %s channel declaration or stop sync",
    async (kind, prefix) => {
      const { gw, channel, offering } = await channelFixture(prefix);
      const declaration = channel.pool.declarationId!;
      const declarationDelta = gw.reactor.get(declaration)!;
      const resolved = gw.containers().containers.get(channel.name);
      expect(resolved).toBeDefined();
      expect(localChannelEvidence(gw, channel.name).state).toBe(
        kind === "protected" ? "open" : "legacy",
      );

      // Federation admits this verified operator-authored row as ordinary data. The container
      // reader rejects it as a declaration because trust and posture are absent.
      const malformed = signClaims(
        {
          author: OP,
          timestamp: declarationDelta.claims.timestamp + 100,
          pointers: [entity("container", channel.name, CTX_CONTAINER)],
        },
        SEED,
      );
      const report = await gw.federate([malformed], { admit: () => true });
      expect(report.accepted).toBe(1);
      expect(gw.reactor.get(malformed.id)).toEqual(malformed);
      expect(gw.containers().containers.get(channel.name)).toEqual(resolved);

      expect.soft(currentPoolDeclaration(gw, channel.name)).toBe(declaration);
      expect
        .soft(localChannelEvidence(gw, channel.name).state)
        .toBe(kind === "protected" ? "open" : "legacy");
      const offered = observed(FERN, "height", prefix.length + 1, 5000, "a1".repeat(32));
      offering.push(offered);
      const synced = await channel.sync().then(
        (value) => ({ state: "fulfilled" as const, value }),
        (error: unknown) => ({ state: "rejected" as const, error }),
      );
      expect.soft(synced.state).toBe("fulfilled");
      if (synced.state === "fulfilled") expect.soft(synced.value.accepted).toBe(1);
      else expect.soft(String(synced.error)).not.toMatch(/stale channel operation/);
      expect.soft(channel.pool.gateway!.reactor.get(offered.id)).toBeDefined();
    },
  );

  it("a pure same-name exclusion remains a nondeclaration", async () => {
    const { gw, channel, offering } = await channelFixture();
    const declaration = channel.pool.declarationId!;
    const declarationDelta = gw.reactor.get(declaration)!;
    const resolved = gw.containers().containers.get(channel.name);
    const pure = signClaims(
      exclusionClaims(channel.name, OP, declarationDelta.claims.timestamp + 100),
      SEED,
    );
    expect((await gw.federate([pure], { admit: () => true })).accepted).toBe(1);
    expect(gw.containers().excluded.has(channel.name)).toBe(true);
    expect(gw.containers().containers.get(channel.name)).toEqual(resolved);
    expect(currentPoolDeclaration(gw, channel.name)).toBe(declaration);
    expect(localChannelEvidence(gw, channel.name).state).toBe("open");

    const offered = observed(FERN, "height", 9, 5001, "a1".repeat(32));
    offering.push(offered);
    expect((await channel.sync()).accepted).toBe(1);
    expect(channel.pool.gateway!.reactor.get(offered.id)).toBeDefined();
  });

  it("a hybrid exclusion row remains a nondeclaration", async () => {
    const { gw, channel, offering } = await channelFixture();
    const declaration = channel.pool.declarationId!;
    const declarationDelta = gw.reactor.get(declaration)!;
    const resolved = gw.containers().containers.get(channel.name);
    const hybrid = signClaims(
      {
        author: OP,
        timestamp: declarationDelta.claims.timestamp + 100,
        pointers: [
          entity("container", channel.name, CTX_CONTAINER),
          entity("container", "container:unrelated", CTX_CONTAINER_EXCLUDED),
        ],
      },
      SEED,
    );
    expect((await gw.federate([hybrid], { admit: () => true })).accepted).toBe(1);
    expect(gw.containers().excluded.has("container:unrelated")).toBe(true);
    expect(gw.containers().containers.get(channel.name)).toEqual(resolved);
    expect.soft(currentPoolDeclaration(gw, channel.name)).toBe(declaration);
    expect.soft(localChannelEvidence(gw, channel.name).state).toBe("open");

    const offered = observed(FERN, "height", 9, 5001, "a1".repeat(32));
    offering.push(offered);
    const synced = await channel.sync().catch(() => undefined);
    expect.soft(synced?.accepted).toBe(1);
    expect.soft(channel.pool.gateway!.reactor.get(offered.id)).toBeDefined();
  });
});
