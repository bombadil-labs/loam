// T288 — local receive is an act of this channel service, not a transferable signature.
// All destructive fixtures are MemoryBackend instances or this file's own mkdtemp SQLite stores.
// Raw writes below represent the explicitly trusted restore/corruption boundary, never federation.
//
// RAILS-RED on origin/main, the seven local-channel suites copied in: none LOADS there. Each imports
// src/federation/local-channel-events.js, which this slice adds, so vitest reports seven failed
// suites and no cases. The revert probes an independent review ran on this tree, one guard deleted
// per probe: the append door's protected refusal (8 red), the federate door's (7 red), the
// transitive closure over strikes (6 red), the local-control branch of survivingTombstones (1 red),
// the eraseReplica authority check (1 red), the two-opens ambiguity (1 red), the exact declaration
// checks on sync (4 red), the partial-opening guard on retry (1 red), and a protected-set memo that
// never sweeps the arrival log (red across the suites). Measured again at 110 cases: a marker that
// does not make this channel's erased history unavailable (1 red); a re-open that ignores whether
// the caller's options agree with the standing record, cached handle or not (1 red).
//
// WHAT THESE RAILS DO NOT ASSERT: a reader resolving through a Schema or a door over the `received`
// operand. No consumer resolves through it yet; `sourceStanding` re-ingests the operand into a fresh
// Reactor and asks lawfulNegated, which is the nearest reader available. The slice that first
// resolves through `received` owes the object-level rail.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  Reactor,
  signClaims,
  verifyDelta,
  type Claims,
  type Delta,
} from "@bombadil/rhizomatic";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { eraseClaims, readTombstones } from "../../src/gateway/erase.js";
import { lawfulNegated } from "../../src/gateway/registration.js";
import { SEALED_LEEWAY } from "../../src/gateway/leeway.js";
import { channelRecordClaims, resumeChannelImpl } from "../../src/federation/channel.js";
import {
  inLocalContext,
  LOCAL_CONTROL,
  localControlChannel,
  localChannelEvidence,
  withChannelCommit,
} from "../../src/federation/local-channel-events.js";
import { toWire } from "../../src/federation/wire.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";

const SEED = "cc".repeat(32);
const OP = authorForSeed(SEED);
const PEER_SEED = "a1".repeat(32);
const PEER = authorForSeed(PEER_SEED);
const EVENT = "loam.local.channel.event";
const CONTROL = "loam.local.channel.control";
const homes: Gateway[] = [];
const dirs: string[] = [];
const servers: ServerHandle[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
  }
  for (const gw of homes.splice(0)) await gw.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

class FaultBackend extends MemoryBackend {
  failAction: string | undefined;
  failPurge = false;
  beforeAppend: ((batch: readonly Delta[]) => Promise<void>) | undefined;
  override async append(deltas: Iterable<Delta>): Promise<number> {
    const batch = [...deltas];
    if (
      this.failAction !== undefined &&
      batch.some((d) => inContext(d, EVENT) && value(d, "action") === this.failAction)
    ) {
      throw new Error(`fixture ${this.failAction} append failure`);
    }
    await this.beforeAppend?.(batch);
    return super.append(batch);
  }
  override async purge(ids: Iterable<string>): Promise<number> {
    if (this.failPurge) throw new Error("fixture purge failure");
    return super.purge(ids);
  }
}
async function home(primary = new FaultBackend()) {
  const pools = new Map<string, FaultBackend>();
  const gw = await Gateway.boot(
    primary,
    assembleGenesis({ operatorSeed: SEED, registrations: [] }),
    {
      // A successful drop closes the old backend. A fresh open must receive fresh physical ground.
      channelBackend: (name) => {
        const backend = new FaultBackend();
        pools.set(name, backend);
        return backend;
      },
    },
  );
  homes.push(gw);
  return { gw, primary, pools };
}
function peer() {
  const offering: Delta[] = [];
  return { offering, source: { pull: () => Promise.resolve([...offering]) } };
}
const fact = (n = 1, seed = PEER_SEED) => observed(FERN, "height", n, 1000 + n, seed);
const signed = (claims: Claims, seed = SEED) => signClaims(claims, seed);
const strike = (d: Delta, seed = SEED, at = 9000) =>
  signed(makeNegationClaims(authorForSeed(seed), at, d.id), seed);
const inContext = (d: Delta, context: string) =>
  d.claims.pointers.some((p) => p.target.kind === "entity" && p.target.entity.context === context);
const value = (d: Delta, role: string) => {
  const p = d.claims.pointers.find((p) => p.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};
const ref = (d: Delta, role: string) => {
  const p = d.claims.pointers.find((p) => p.role === role);
  return p?.target.kind === "delta" ? p.target.deltaRef.delta : undefined;
};
const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();
const events = (gw: Gateway, action?: string) =>
  [...gw.reactor.snapshot()].filter(
    (d) => inContext(d, EVENT) && (action === undefined || value(d, "action") === action),
  );
const e = (role: string, id: string, context: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});
const p = (role: string, v: string | number): Claims["pointers"][number] => ({
  role,
  target: { kind: "primitive", value: v },
});
const r = (role: string, id: string): Claims["pointers"][number] => ({
  role,
  target: { kind: "delta", deltaRef: { delta: id } },
});
function header(name: string, action: string) {
  return [e("event", `channel:${name}`, EVENT), p("version", 1), p("action", action)];
}
// Independently spelled literal fixtures; no production event builder/parser is imported.
function openLiteral(name: string, status: string, declaration: string, bound?: string): Claims {
  return {
    author: OP,
    timestamp: 100,
    pointers: [
      ...header(name, "open"),
      p("nonce", "0123456789abcdef".repeat(4)),
      p("into", "friends"),
      p("prefix", "peer"),
      p("from", "https://peer.example/default"),
      p("opener-kind", bound === undefined ? "root" : "bound"),
      ...(bound === undefined ? [] : [p("opened-by", "friends"), p("opened-from", bound)]),
      r("status-at-open", status),
      r("pool-declaration", declaration),
    ],
  };
}
function receivedLiteral(name: string, opening: string, received: readonly string[]): Claims {
  return {
    author: OP,
    timestamp: 101,
    pointers: [
      ...header(name, "received"),
      r("opening", opening),
      ...received.map((id) => r("received", id)),
    ],
  };
}
function closeLiteral(name: string, opening: string): Claims {
  return {
    author: OP,
    timestamp: 102,
    pointers: [...header(name, "close"), r("opening", opening), p("reason", "drop")],
  };
}
function markedErase(target: Delta): Delta {
  const claims = eraseClaims(target.id, target.claims.author, OP, 10000);
  return signed({
    ...claims,
    pointers: [
      ...claims.pointers,
      e("local-control", target.id, CONTROL),
      p("local-control-version", 1),
      p("local-control-kind", "erase"),
    ],
  });
}
async function raw(gw: Gateway, batch: readonly Delta[]) {
  await gw.backend.append(batch);
  for (const d of batch) expect(gw.reactor.ingest(d).status).not.toBe("rejected");
}
function opened(gw: Gateway, name: string) {
  const evidence = localChannelEvidence(gw, name);
  expect(evidence.state).toBe("open");
  if (evidence.state !== "open") throw new Error(`expected open: ${JSON.stringify(evidence)}`);
  return evidence;
}
function sourceStanding(gw: Gateway, name: string, id: string) {
  const ground = new Reactor();
  const operand = opened(gw, name).received;
  for (const d of operand) ground.ingest(d);
  return ground.get(id) !== undefined && !lawfulNegated(ground, PEER)(id);
}
async function channel(gw: Gateway, feed = peer(), prefix = "peer") {
  const ch = await gw.openChannel({
    into: "friends",
    prefix,
    from: "https://peer.example/default",
    source: feed.source,
  });
  return { ch, ...feed, pool: ch.pool.gateway! };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function legacyFixture(gw: Gateway) {
  // Real service creates the ordinary declarations/status. Removing ONLY new events simulates
  // a supported pre-vocabulary history; the ordinary channel behavior is not mocked.
  const fixture = await channel(gw);
  const protectedIds = ids(events(gw));
  await gw.backend.purge(protectedIds);
  // Reopen a copied, trusted old history to avoid inventing a reactor deletion API.
  const root = new MemoryBackend();
  await root.append(await gw.backend.deltasSince(new Set()));
  const poolBytes = await fixture.pool.backend.deltasSince(new Set());
  let poolBackend = new MemoryBackend();
  await poolBackend.append(poolBytes);
  const restored = await Gateway.open(root, { seed: SEED, channelBackend: () => poolBackend });
  homes.push(restored);
  await restored.resumeChannels();
  return {
    freshBackend: () => {
      poolBackend = new MemoryBackend();
    },
    gw: restored,
    name: fixture.ch.name,
    source: fixture.source,
    offering: fixture.offering,
  };
}

// API opts are intentionally typed at the call site: T288's report is opt-in, not a changed default.
describe("T288 actual ingest attestation", () => {
  it("reports unique sorted accepted AND identical held IDs only when explicitly requested", async () => {
    const { gw } = await home();
    const a = fact(1),
      b = fact(2);
    const first = await gw.federate([b, a, b], { ids: true, admittedIds: true });
    expect(first.accepted).toBe(2);
    expect(first.admittedIds).toEqual([a.id, b.id].sort());
    const held = await gw.federate([a, b], { ids: true, admittedIds: true });
    expect(held.accepted).toBe(0);
    expect(held.admittedIds).toEqual([a.id, b.id].sort());
    expect(await gw.federate([a])).toEqual({ offered: 1, accepted: 0, rejected: 0, held: 1 });
    expect(await gw.federate([a], { ids: true })).not.toHaveProperty("admittedIds");
    await expect(gw.federate([a], { admittedIds: true })).rejects.toThrow();
  });
  it("excludes actual rejected ingest even when identical verified bytes are held", async () => {
    const { gw } = await home();
    const a = fact();
    await gw.federate([a]);
    const real = gw.ingestVia;
    gw.ingestVia = (d) =>
      d.id === a.id ? { status: "rejected", reason: "fixture explicit refusal" } : real(d);
    const report = await gw.federate([a], { ids: true, admittedIds: true });
    expect(gw.reactor.get(a.id)).toEqual(a);
    expect(report.admittedIds).toEqual([]);
  });
  it("cannot attest fake duplicate outcomes, mismatched held bytes, bad signatures, or admission refusal", async () => {
    const { gw } = await home();
    const a = fact();
    const real = gw.ingestVia;
    gw.ingestVia = () => ({ status: "duplicate" });
    expect((await gw.federate([a], { ids: true, admittedIds: true })).admittedIds).toEqual([]);
    expect(gw.reactor.get(a.id)).toBeUndefined();
    gw.ingestVia = real;
    await gw.federate([a]);
    const originalGet = gw.reactor.get.bind(gw.reactor);
    vi.spyOn(gw.reactor, "get").mockImplementation((id) =>
      id === a.id
        ? { ...a, claims: { ...a.claims, timestamp: a.claims.timestamp + 1 } }
        : originalGet(id),
    );
    expect((await gw.federate([a], { ids: true, admittedIds: true })).admittedIds).toEqual([]);
    vi.restoreAllMocks();
    const bad = { ...fact(2), sig: a.sig! };
    expect(
      (await gw.federate([bad, a], { ids: true, admittedIds: true, admit: () => false }))
        .admittedIds,
    ).toEqual([]);
    expect((await gw.federate([bad], { ids: true, admittedIds: true })).admittedIds).toEqual([]);
  });
  it("an exception after a real ingest returns no attestation and permits a later genuine offer", async () => {
    const { gw } = await home();
    const a = fact(),
      b = fact(2);
    const real = gw.ingestVia;
    gw.ingestVia = (d) => {
      const result = real(d);
      if (d.id === b.id) throw new Error("fixture ingest crash");
      return result;
    };
    await expect(gw.federate([a, b], { ids: true, admittedIds: true })).rejects.toThrow(
      /ingest crash/,
    );
    expect(gw.reactor.get(a.id)).toBeDefined();
    gw.ingestVia = real;
    expect((await gw.federate([a, b], { ids: true, admittedIds: true })).admittedIds).toEqual(
      [a.id, b.id].sort(),
    );
  });
});

describe("T288 exact local lifecycle and independent v1 vocabulary", () => {
  it("fresh root opening names the exact status/declaration; later status and handle reuse preserve it", async () => {
    const { gw } = await home();
    const { ch, source } = await channel(gw);
    const initial = opened(gw, ch.name);
    expect(initial.opening).toMatchObject({
      channel: "channel:friends:peer",
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/default",
    });
    const d = gw.reactor.get(initial.opening.id)!;
    const expected = openLiteral(
      ch.name,
      initial.opening.statusAtOpen,
      initial.opening.poolDeclaration,
    );
    expect(d.claims.pointers).toEqual(
      expected.pointers.map((pt) =>
        pt.role === "nonce" ? p("nonce", String(value(d, "nonce"))) : pt,
      ),
    );
    expect(value(d, "nonce")).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyDelta(d)).toBe("verified");
    expect(Number.isSafeInteger(d.claims.timestamp) && d.claims.timestamp >= 0).toBe(true);
    const status = gw.reactor.get(initial.opening.statusAtOpen)!;
    expect(inContext(status, "loam.channel")).toBe(true);
    expect(value(status, "from")).toBe(initial.opening.from);
    const declaration = gw.reactor.get(initial.opening.poolDeclaration)!;
    expect(inContext(declaration, "loam.container")).toBe(true);
    expect(readContainerTable(gw.reactor, OP).containers.has(ch.name)).toBe(true);
    await gw.setChannel(ch.name, { blessing: false });
    expect(opened(gw, ch.name).opening).toEqual(initial.opening);
    const again = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/default",
      source,
    });
    expect(again.pool).toBe(ch.pool);
    expect(opened(gw, ch.name).opening).toEqual(initial.opening);
    expect(events(gw, "open")).toHaveLength(1);
  });
  it("bound opening records exact live binding; receiving actually uses its channel pool", async () => {
    const { gw } = await home();
    await gw.append([
      signed(
        containerClaims(
          {
            container: "ada:journal",
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: "none" } },
              in: "input",
            },
            leeway: { ...SEALED_LEEWAY, receive: true },
          },
          OP,
          gw.nextTimestamp(),
        ),
      ),
    ]);
    const inbox = await gw.bindConnection({
      container: "ada:journal",
      connectionKey: authorForSeed("b2".repeat(32)),
      ownerSeed: "d4".repeat(32),
    });
    const a = fact();
    const ch = await gw.openChannel({
      into: "ada:journal",
      prefix: "ada:journal:peer",
      openedBy: "ada:journal",
      openedFrom: inbox.entity!,
      source: { pull: () => Promise.resolve([a]) },
    });
    await ch.sync();
    const evidence = opened(gw, ch.name);
    expect(evidence.opening.openedBy).toBe("ada:journal");
    expect(evidence.opening.openedFrom).toBe(inbox.entity);
    expect(ids(evidence.received)).toEqual([a.id]);
    const d = gw.reactor.get(evidence.opening.id)!;
    expect(d.claims.pointers.map((p) => p.role)).toEqual([
      "event",
      "version",
      "action",
      "nonce",
      "into",
      "prefix",
      "from",
      "opener-kind",
      "opened-by",
      "opened-from",
      "status-at-open",
      "pool-declaration",
    ]);
    expect(value(d, "opener-kind")).toBe("bound");
    expect(ch.pool.gateway!.reactor.get(a.id)).toBeDefined();
    expect(gw.reactor.get(a.id)).toBeUndefined();
  });
  it("legacy resume and unresumed attachment do not mint evidence; a deliberate drop/new open does", async () => {
    const old = await legacyFixture((await home()).gw);
    expect(localChannelEvidence(old.gw, old.name)).toEqual({ state: "legacy" });
    const ch = await old.gw.openChannel({
      into: "friends",
      prefix: "peer",
      source: old.source,
      from: "https://peer.example/default",
    });
    old.offering.push(fact());
    await ch.sync();
    expect(localChannelEvidence(old.gw, old.name)).toEqual({ state: "legacy" });
    expect(events(old.gw)).toEqual([]);
    await old.gw.dropChannel(old.name);
    // New physical backend for the next lifetime.
    old.freshBackend();
    const fresh = await old.gw.openChannel({ into: "friends", prefix: "peer", source: old.source });
    expect(opened(old.gw, fresh.name).received).toEqual([]);
  });
  it("empty legacy-compatible prefix stays legacy; blank from is a valid fresh local offer", async () => {
    const { gw } = await home();
    const empty = await gw.openChannel({ into: "friends", prefix: "", source: peer().source });
    expect(localChannelEvidence(gw, empty.name)).toEqual({ state: "legacy" });
    const local = await gw.openChannel({ into: "local", prefix: "local", source: peer().source });
    expect(opened(gw, local.name).opening.from).toBe("");
  });
  it("close precedes physical purge; successful drop is unavailable, reopen uses new exact declaration and excludes old receipts", async () => {
    const { gw, pools } = await home();
    const { ch, offering, source } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    const old = opened(gw, ch.name);
    const bystander = await channel(gw, peer(), "bystander");
    bystander.offering.push(fact(2));
    await bystander.ch.sync();
    const backend = pools.get(ch.name)!;
    const purge = backend.purge.bind(backend);
    backend.purge = async (targetIds) => {
      expect(localChannelEvidence(gw, ch.name).state).toBe("closed");
      const close = events(gw, "close")[0]!;
      expect(close.claims.pointers).toEqual(closeLiteral(ch.name, old.opening.id).pointers);
      return purge(targetIds);
    };
    await gw.dropChannel(ch.name);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(ids(opened(gw, bystander.ch.name).received)).toEqual([fact(2).id]);
    const fresh = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      source,
      from: old.opening.from,
    });
    const current = opened(gw, fresh.name);
    expect(current.opening.id).not.toBe(old.opening.id);
    expect(current.opening.poolDeclaration).not.toBe(old.opening.poolDeclaration);
    expect(current.received).toEqual([]);
  });
});

describe("T288 protected ingress is unconditional across same-key homes", () => {
  it("append, admit override, root seeding and HTTP cannot import any local event; ordinary controls still work", async () => {
    const a = await home(),
      b = await home();
    const { ch, offering } = await channel(a.gw);
    offering.push(fact());
    await ch.sync();
    a.pools.get(ch.name)!.failPurge = true;
    await expect(a.gw.dropChannel(ch.name)).rejects.toThrow();
    const records = events(a.gw);
    expect(new Set(records.map((d) => value(d, "action")))).toEqual(
      new Set(["open", "received", "close"]),
    );
    const admitted: string[] = [];
    for (const record of records) await expect(b.gw.append([record])).rejects.toThrow();
    const report = await b.gw.federate(records, {
      ids: true,
      admittedIds: true,
      admit: (d) => {
        admitted.push(d.id);
        return true;
      },
    });
    expect(report.admittedIds).toEqual([]);
    expect(admitted).toEqual([]);
    expect(events(b.gw)).toEqual([]);
    expect(localChannelEvidence(b.gw, ch.name)).toEqual({ state: "legacy" });
    const legacy = a.gw.reactor.get(openedOrClosed(a.gw, ch.name).statusAtOpen)!;
    await b.gw.append([legacy]);
    expect(b.gw.channelStatus(ch.name)).toHaveLength(1);
    expect(localChannelEvidence(b.gw, ch.name)).toEqual({ state: "legacy" });
    // A's primary events are also ordinary seed input when A creates another channel pool.
    const extra = await channel(a.gw, peer(), "extra");
    expect(events(extra.pool)).toEqual([]);
    const server = await serve({
      mounts: { default: b.gw },
      tokens: { token: { operator: true } },
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    const post = (batch: readonly Delta[]) =>
      fetch(`${server.url}/default/append`, {
        method: "POST",
        headers: { authorization: "Bearer token", "content-type": "application/json" },
        body: JSON.stringify({ deltas: batch.map(toWire) }),
      });
    for (const record of records) expect((await post([record])).status).toBeGreaterThanOrEqual(400);
    const ordinary = fact(20, SEED);
    expect((await post([ordinary])).status).toBe(200);
    expect(b.gw.reactor.get(ordinary.id)).toBeDefined();
    expect(events(b.gw)).toEqual([]);
  });
  it.each([EVENT, CONTROL])(
    "reserves ANY entity pointer in %s before shape and callback checks",
    async (context) => {
      const { gw } = await home();
      const malformed = signed({
        author: OP,
        timestamp: 100,
        pointers: [p("ordinary", "first"), e("wrong-role", "not-a-channel", context)],
      });
      let callbacks = 0;
      await expect(gw.append([malformed])).rejects.toThrow();
      expect(
        (
          await gw.federate([malformed], {
            ids: true,
            admittedIds: true,
            admit: () => {
              callbacks++;
              return true;
            },
          })
        ).admittedIds,
      ).toEqual([]);
      expect(callbacks).toBe(0);
      expect(await gw.backend.holds(malformed.id)).toBe(false);
    },
  );
  it("rejects held and batch-proposed event deletion plus forward negation closure, preserving ordinary negations", async () => {
    const { gw } = await home();
    const { ch } = await channel(gw);
    const open = gw.reactor.get(opened(gw, ch.name).opening.id)!;
    const s = strike(open),
      ss = strike(s),
      erase = signed(eraseClaims(open.id, OP, OP, 10001));
    const target = fact(5, SEED),
      ordinaryStrike = strike(target);
    await gw.append([target, ordinaryStrike]);
    expect(gw.reactor.get(ordinaryStrike.id)).toBeDefined();
    for (const d of [s, ss, erase]) {
      // For ss the protected target is batch-proposed, so closure must be transitive in any order.
      const batch = d === ss ? [ss, s] : [d];
      await expect(gw.append(batch)).rejects.toThrow();
      expect(
        (await gw.federate(batch, { ids: true, admittedIds: true, admit: () => true })).admittedIds,
      ).toEqual([]);
    }
    const other = (await home()).gw;
    const report = await other.federate([ss, s, open, target], {
      ids: true,
      admittedIds: true,
      admit: () => true,
    });
    expect(report.admittedIds).toEqual([target.id]);
    expect(opened(gw, ch.name).opening.id).toBe(open.id);
  });
});
function openedOrClosed(gw: Gateway, name: string) {
  const evidence = localChannelEvidence(gw, name);
  if (evidence.state !== "open" && evidence.state !== "closed")
    throw new Error(JSON.stringify(evidence));
  return evidence.opening;
}

describe("T288 honest local received operand", () => {
  it("pooled bytes, old arrival stamps and unattested debt cannot attest without a new actual offer", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact(),
      b = fact(2);
    await pool.federate([a, b]);
    const arrival = signed({
      author: OP,
      timestamp: 3000,
      pointers: [
        e("arrival", `channel:${ch.name}`, "loam.arrival"),
        p("from", "https://peer.example/default"),
        r("arrived", a.id),
      ],
    });
    await pool.federate([arrival]);
    await gw.append([
      signed(
        channelRecordClaims(
          { ...gw.channelStatus(ch.name)[0]!, unattested: [a.id, b.id] },
          OP,
          gw.nextTimestamp(),
        ),
      ),
    ]);
    await ch.sync();
    expect(opened(gw, ch.name).received).toEqual([]);
    offering.push(a);
    expect((await ch.sync()).accepted).toBe(0);
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
    const receipt = events(gw, "received")[0]!;
    expect(receipt.claims.pointers).toEqual(
      receivedLiteral(ch.name, opened(gw, ch.name).opening.id, [a.id]).pointers,
    );
    expect(receipt.claims.timestamp).toBeGreaterThan(arrival.claims.timestamp);
    await ch.sync();
    expect(events(gw, "received")).toHaveLength(1);
    expect(pool.reactor.get(b.id)).toBeDefined();
    expect(sourceStanding(gw, ch.name, b.id)).toBe(false);
  });
  it("received source-author strike and strike-of-strike determine lineage; raw/seeded strikes do not", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact(),
      s = strike(a, PEER_SEED),
      ss = strike(s, PEER_SEED, 9001);
    offering.push(a);
    await ch.sync();
    expect(sourceStanding(gw, ch.name, a.id)).toBe(true);
    await pool.federate([s]);
    expect(sourceStanding(gw, ch.name, a.id)).toBe(true);
    offering.push(s);
    await ch.sync();
    expect(sourceStanding(gw, ch.name, a.id)).toBe(false);
    await pool.federate([ss]);
    expect(sourceStanding(gw, ch.name, a.id)).toBe(false);
    offering.push(ss);
    await ch.sync();
    expect(sourceStanding(gw, ch.name, a.id)).toBe(true);
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id, s.id, ss.id].sort());
    const outsider = strike(a, "b2".repeat(32), 10000);
    offering.push(outsider);
    await ch.sync();
    expect(sourceStanding(gw, ch.name, a.id)).toBe(true);
  });
  it("source erasure leaves exact receipt citation dangling and makes the whole operand unavailable", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact(),
      b = fact(2);
    offering.push(a, b);
    await ch.sync();
    const receipt = events(gw, "received")[0]!;
    // Existing root erasure acts on a root-held target; seed the same exact source before its cut.
    await gw.federate([a]);
    const report = await gw.erase(a.id);
    expect(report.citations).toContain(receipt.id);
    expect(pool.reactor.get(a.id)).toBeUndefined();
    expect(pool.reactor.get(b.id)).toBeDefined();
    expect(gw.reactor.get(receipt.id)).toBeDefined();
    const evidence = localChannelEvidence(gw, ch.name);
    expect(evidence.state).toBe("unavailable");
    expect(evidence).not.toHaveProperty("received");
  });
  it("returned claims/opening are detached: attempted mutation cannot change later source eligibility", async () => {
    const { gw } = await home();
    const { ch, offering } = await channel(gw);
    const a = fact(),
      s = strike(a, PEER_SEED);
    offering.push(a, s);
    await ch.sync();
    const snapshot = opened(gw, ch.name);
    expect(sourceStanding(gw, ch.name, a.id)).toBe(false);
    const before = JSON.stringify(snapshot);
    const attempts = [
      () => Reflect.set(snapshot.opening, "from", "https://attacker.example"),
      () => Reflect.set(snapshot.received, "length", 0),
      () => Reflect.set(snapshot.received.find((d: Delta) => d.id === s.id)!.claims, "author", OP),
      () =>
        Reflect.set(
          snapshot.received.find((d: Delta) => d.id === s.id)!.claims.pointers[0]!.target,
          "kind",
          "primitive",
        ),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
      } catch {
        /* immutable copies may throw */
      }
    }
    expect(JSON.stringify(opened(gw, ch.name))).toBe(before);
    expect(sourceStanding(gw, ch.name, a.id)).toBe(false);
  });
  it("signature and real admission refusals in a channel offer cannot receive attestation", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact(),
      refused = fact(2),
      invalid = { ...fact(3), sig: a.sig! };
    const real = pool.federate.bind(pool);
    pool.federate = (batch, opts) => real(batch, { ...opts, admit: (d) => d.id !== refused.id });
    offering.push(a, refused, invalid);
    await ch.sync();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
    expect(pool.reactor.get(refused.id)).toBeUndefined();
    expect(pool.reactor.get(invalid.id)).toBeUndefined();
    pool.federate = real;
    offering.length = 0;
    offering.push(refused);
    await ch.sync();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id, refused.id].sort());
  });
  it("actual rejected and throwing channel ingest cannot create received evidence", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact();
    offering.push(a);
    const real = pool.ingestVia;
    pool.ingestVia = (d) =>
      d.id === a.id ? { status: "rejected", reason: "fixture refused" } : real(d);
    await ch.sync();
    expect(opened(gw, ch.name).received).toEqual([]);
    pool.ingestVia = (d) => {
      const result = real(d);
      if (d.id === a.id) throw new Error("fixture ingest failure");
      return result;
    };
    await expect(ch.sync()).rejects.toThrow(/ingest failure/);
    expect(pool.reactor.get(a.id)).toBeDefined();
    expect(opened(gw, ch.name).received).toEqual([]);
    pool.ingestVia = real;
    await ch.sync();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
  });
});

describe("T288 partial writes and shared channel commit order", () => {
  it("failed protected open leaves a real legacy pool and never auto-promotes partial retry", async () => {
    const { gw, primary } = await home();
    primary.failAction = "open";
    await expect(channel(gw)).rejects.toThrow(/open append failure/);
    expect(gw.channelStatus("channel:friends:peer")).toHaveLength(1);
    expect(gw.channelPools.has("channel:friends:peer")).toBe(true);
    expect(events(gw, "open")).toEqual([]);
    primary.failAction = undefined;
    const { ch, offering } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    expect(localChannelEvidence(gw, ch.name).state).not.toBe("open");
    expect(events(gw, "open")).toEqual([]);
  });
  it("source bytes commit before delayed receipt; failed receipt stays unproven until actually offered again", async () => {
    const { gw, primary } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact();
    offering.push(a);
    const entered = deferred<void>(),
      release = deferred<void>();
    primary.beforeAppend = async (batch) => {
      if (batch.some((d) => inContext(d, EVENT) && value(d, "action") === "received")) {
        entered.resolve();
        await release.promise;
        throw new Error("fixture receipt crash");
      }
    };
    const pending = ch.sync();
    const rejected = expect(pending).rejects.toThrow(/receipt crash/);
    await entered.promise;
    expect(await pool.backend.holds(a.id)).toBe(true);
    expect(pool.reactor.get(a.id)).toBeDefined();
    expect(opened(gw, ch.name).received).toEqual([]);
    release.resolve();
    await rejected;
    primary.beforeAppend = undefined;
    offering.length = 0;
    await ch.sync();
    expect(opened(gw, ch.name).received).toEqual([]);
    offering.push(a);
    await ch.sync();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
  });
  it("source backend failure cannot mint a receipt; later successful commit does", async () => {
    const { gw, pools } = await home();
    const { ch, offering } = await channel(gw);
    const a = fact();
    offering.push(a);
    pools.get(ch.name)!.beforeAppend = (batch) =>
      batch.some((d) => d.id === a.id)
        ? Promise.reject(new Error("fixture source write failure"))
        : Promise.resolve();
    await expect(ch.sync()).rejects.toThrow(/source write failure/);
    expect(events(gw, "received")).toEqual([]);
    expect(opened(gw, ch.name).received).toEqual([]);
    pools.get(ch.name)!.beforeAppend = undefined;
    await ch.sync();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
  });
  it("failed close prevents purge; failed purge leaves closed attachment; retry adds no redundant close", async () => {
    const { gw, primary, pools } = await home();
    const { ch, pool, offering } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    primary.failAction = "close";
    await expect(gw.dropChannel(ch.name)).rejects.toThrow(/close append failure/);
    expect(await pool.backend.holds(fact().id)).toBe(true);
    expect(localChannelEvidence(gw, ch.name).state).toBe("open");
    primary.failAction = undefined;
    pools.get(ch.name)!.failPurge = true;
    await expect(gw.dropChannel(ch.name)).rejects.toThrow();
    expect(localChannelEvidence(gw, ch.name).state).toBe("closed");
    expect(gw.channelPools.has(ch.name)).toBe(true);
    expect(events(gw, "close")).toHaveLength(1);
    pools.get(ch.name)!.failPurge = false;
    await gw.dropChannel(ch.name);
    expect(events(gw, "close")).toHaveLength(1);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
  });
  it("a rejected queue body does not poison later operations or block a different name", async () => {
    const { gw } = await home();
    const held = deferred<void>(),
      entered = deferred<void>();
    const first = withChannelCommit(gw, "one", async () => {
      entered.resolve();
      await held.promise;
      throw new Error("fixture queue failure");
    });
    const rejected = expect(first).rejects.toThrow(/queue failure/);
    await entered.promise;
    const order: string[] = [];
    const second = withChannelCommit(gw, "one", () => {
      order.push("second");
      return Promise.resolve(2);
    });
    expect(await withChannelCommit(gw, "two", () => Promise.resolve(3))).toBe(3);
    expect(order).toEqual([]);
    held.resolve();
    await rejected;
    expect(await second).toBe(2);
    expect(order).toEqual(["second"]);
  });
  it("concurrent fresh opens share one exact incarnation", async () => {
    const { gw } = await home();
    const feed = peer();
    const [a, b] = await Promise.all([channel(gw, feed), channel(gw, feed)]);
    expect(a.ch.pool).toBe(b.ch.pool);
    expect(events(gw, "open")).toHaveLength(1);
    feed.offering.push(fact());
    await Promise.all([a.ch.sync(), b.ch.sync()]);
    expect(events(gw, "received")).toHaveLength(1);
    expect(ids(opened(gw, a.ch.name).received)).toEqual([fact().id]);
  });
  it.each([false, true])(
    "stale %s pull after drop/reopen rejects without status/debt/receipt writes",
    async (fails) => {
      const { gw } = await home();
      const entered = deferred<void>(),
        network = deferred<readonly Delta[]>();
      const old = await gw.openChannel({
        into: "friends",
        prefix: "peer",
        source: {
          pull: () => {
            entered.resolve();
            return network.promise;
          },
        },
      });
      const oldSync = old.sync();
      const rejection = expect(oldSync).rejects.toThrow(/stale channel operation/);
      await entered.promise;
      await gw.dropChannel(old.name);
      const fresh = await channel(gw);
      const before = ids([...gw.reactor.snapshot()]);
      if (fails) network.reject(new Error("old network failure"));
      else network.resolve([fact()]);
      await rejection;
      expect(ids([...gw.reactor.snapshot()])).toEqual(before);
      expect(opened(gw, fresh.ch.name).received).toEqual([]);
      fresh.offering.push(fact(2));
      await fresh.ch.sync();
      expect(ids(opened(gw, fresh.ch.name).received)).toEqual([fact(2).id]);
    },
  );
  it.each([false, true])(
    "legacy handle stale pull failure=%s cannot overwrite a protected reopen",
    async (fails) => {
      const old = await legacyFixture((await home()).gw);
      const entered = deferred<void>(),
        network = deferred<readonly Delta[]>();
      const handle = await old.gw.openChannel({
        into: "friends",
        prefix: "peer",
        from: "https://peer.example/default",
        source: {
          pull: () => {
            entered.resolve();
            return network.promise;
          },
        },
      });
      const pending = handle.sync();
      const rejected = expect(pending).rejects.toThrow(/stale channel operation/);
      await entered.promise;
      await old.gw.dropChannel(handle.name);
      old.freshBackend();
      const fresh = await channel(old.gw);
      const before = ids([...old.gw.reactor.snapshot()]);
      if (fails) network.reject(new Error("legacy stale failure"));
      else network.resolve([fact()]);
      await rejected;
      expect(ids([...old.gw.reactor.snapshot()])).toEqual(before);
      expect(opened(old.gw, fresh.ch.name).received).toEqual([]);
    },
  );
  it("resumed and fresh handles plus scheduler serialize commit; drop cannot deadlock stopping queued sync", async () => {
    const { gw, pools } = await home();
    const a = fact();
    const schedulerPull = deferred<void>();
    const schedulerOffer = deferred<readonly Delta[]>();
    let pulls = 0;
    const ch = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/default",
      source: {
        pull: () => {
          pulls++;
          if (pulls === 1) return Promise.resolve([a]);
          schedulerPull.resolve();
          return schedulerOffer.promise;
        },
      },
    });
    const resumed = resumeChannelImpl(gw, gw.channelStatus(ch.name)[0]!, "token");
    const resumedPull = deferred<void>();
    vi.stubGlobal("fetch", () => {
      resumedPull.resolve();
      return Promise.resolve(
        new Response(JSON.stringify({ deltas: [toWire(a)] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    const sourceCommit = deferred<void>(),
      releaseSource = deferred<void>();
    pools.get(ch.name)!.beforeAppend = async (batch) => {
      if (batch.some((d) => d.id === a.id)) {
        sourceCommit.resolve();
        await releaseSource.promise;
      }
    };
    const manual = ch.sync();
    await sourceCommit.promise;
    const restored = resumed.sync();
    await resumedPull.promise;
    expect(opened(gw, ch.name).received).toEqual([]);
    releaseSource.resolve();
    const [manualReport, resumedReport] = await Promise.all([manual, restored]);
    expect(manualReport.accepted).toBe(1);
    expect(resumedReport.accepted).toBe(0);
    expect(events(gw, "received")).toHaveLength(1);
    pools.get(ch.name)!.beforeAppend = undefined;

    const lock = deferred<void>(),
      entered = deferred<void>();
    const holding = withChannelCommit(gw, ch.name, async () => {
      entered.resolve();
      await lock.promise;
    });
    await entered.promise;
    const scheduler = gw.keepSyncing({ everyMs: 20 });
    // Wait for an actual scheduler pull. No elapsed-time assumption can substitute for entry.
    await schedulerPull.promise;
    expect(pulls).toBe(2);
    // Drop queues first; the scheduler's post-pull commit must then reject its stale association.
    const dropping = gw.dropChannel(ch.name);
    schedulerOffer.resolve([fact(2)]);
    lock.resolve();
    await holding;
    await dropping;
    await scheduler.stop();
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(events(gw, "received")).toHaveLength(1);
    expect(
      events(gw, "received")[0]!.claims.pointers.some(
        (pt) => pt.target.kind === "delta" && pt.target.deltaRef.delta === fact(2).id,
      ),
    ).toBe(false);
    expect(gw.channelStatus(ch.name)).toEqual([]);
  }, 10000);
});

// Replace only the protected rows of an owned fixture, preserving real status/declaration/pool
// association. This is trusted history injection to test the projector, not an import loophole.
async function literalFixture() {
  const fixture = await home();
  const current = await channel(fixture.gw);
  const opening = opened(fixture.gw, current.ch.name).opening;
  await fixture.primary.purge(ids(events(fixture.gw)));
  await fixture.gw.reseat();
  const claims = openLiteral(current.ch.name, opening.statusAtOpen, opening.poolDeclaration);
  return { ...fixture, ...current, claims };
}

describe("T288 strict literal history and exact attachment projection", () => {
  it("reads independent complete open/received/close literals and ignores unrelated generic negations", async () => {
    const f = await literalFixture();
    const open = signed(f.claims),
      a = fact();
    await f.pool.federate([a]);
    const received = signed(receivedLiteral(f.ch.name, open.id, [a.id]));
    await raw(f.gw, [open, received]);
    expect(opened(f.gw, f.ch.name).opening.id).toBe(open.id);
    expect(ids(opened(f.gw, f.ch.name).received)).toEqual([a.id]);
    // Unknown-target negation was generic before these rows existed; it cannot gain local power.
    await raw(f.gw, [strike(open)]);
    expect(opened(f.gw, f.ch.name).opening.id).toBe(open.id);
    const close = signed(closeLiteral(f.ch.name, open.id));
    await raw(f.gw, [close, strike(close)]);
    expect(localChannelEvidence(f.gw, f.ch.name).state).toBe("closed");
  });
  const malformedOpens: readonly [string, (c: Claims) => Claims][] = [
    [
      "wrong reference kind",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) =>
          pt.role === "status-at-open" ? p("status-at-open", "not-a-delta") : pt,
        ),
      }),
    ],
    [
      "short reference",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) =>
          pt.role === "pool-declaration" ? r("pool-declaration", "short") : pt,
        ),
      }),
    ],
    ["unknown role", (c) => ({ ...c, pointers: [...c.pointers, p("extra", "no")] })],
    ["duplicate version", (c) => ({ ...c, pointers: [...c.pointers, p("version", 1)] })],
    [
      "pointer order",
      (c) => ({ ...c, pointers: [c.pointers[1]!, c.pointers[0]!, ...c.pointers.slice(2)] }),
    ],
    [
      "partial bound opener",
      (c) => ({
        ...c,
        pointers: c.pointers.flatMap((pt) =>
          pt.role === "opener-kind" ? [p("opener-kind", "bound"), p("opened-by", "friends")] : [pt],
        ),
      }),
    ],
    [
      "root with bound attribution",
      (c) => ({
        ...c,
        pointers: [
          ...c.pointers.slice(0, 8),
          p("opened-by", "friends"),
          p("opened-from", "inbox:friends:key"),
          ...c.pointers.slice(8),
        ],
      }),
    ],
    [
      "uppercase nonce",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) => (pt.role === "nonce" ? p("nonce", "AB".repeat(32)) : pt)),
      }),
    ],
    [
      "short nonce",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) => (pt.role === "nonce" ? p("nonce", "ab".repeat(31)) : pt)),
      }),
    ],
    [
      "NUL source",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) =>
          pt.role === "from" ? p("from", "https://peer.example/\0default") : pt,
        ),
      }),
    ],
    [
      "empty prefix",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) => (pt.role === "prefix" ? p("prefix", "") : pt)),
      }),
    ],
    [
      "wrong source association",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) =>
          pt.role === "from" ? p("from", "https://other.example/default") : pt,
        ),
      }),
    ],
    ["fractional timestamp", (c) => ({ ...c, timestamp: 1.5 })],
    ["negative timestamp", (c) => ({ ...c, timestamp: -1 })],
    [
      "unknown version",
      (c) => ({
        ...c,
        pointers: c.pointers.map((pt) => (pt.role === "version" ? p("version", 2) : pt)),
      }),
    ],
  ];
  it.each(malformedOpens)("refuses literal %s as unavailable", async (_label, transform) => {
    const f = await literalFixture();
    await raw(f.gw, [signed(transform(f.claims))]);
    expect(localChannelEvidence(f.gw, f.ch.name).state).toBe("unavailable");
  });
  it.each([
    "duplicates",
    "unsorted",
    "missing",
    "wrong-channel",
    "missing-opening",
    "extra-role",
    "wrong-kind",
  ])("refuses received literal %s without returning a partial operand", async (defect) => {
    const f = await literalFixture();
    const open = signed(f.claims),
      a = fact(),
      b = fact(2);
    await f.pool.federate([a, b]);
    const sorted = [a.id, b.id].sort();
    let claims = receivedLiteral(f.ch.name, open.id, sorted);
    if (defect === "duplicates") claims = receivedLiteral(f.ch.name, open.id, [a.id, a.id]);
    if (defect === "unsorted") claims = receivedLiteral(f.ch.name, open.id, [...sorted].reverse());
    if (defect === "missing") claims = receivedLiteral(f.ch.name, open.id, [fact(99).id]);
    if (defect === "wrong-channel")
      claims = receivedLiteral("channel:friends:other", open.id, sorted);
    if (defect === "missing-opening") claims = receivedLiteral(f.ch.name, fact(98).id, sorted);
    if (defect === "extra-role")
      claims = { ...claims, pointers: [...claims.pointers, p("extra", "no")] };
    if (defect === "wrong-kind")
      claims = { ...claims, pointers: [...claims.pointers.slice(0, 4), p("received", a.id)] };
    await raw(f.gw, [open, signed(claims)]);
    const evidence = localChannelEvidence(f.gw, f.ch.name);
    expect(evidence.state).toBe("unavailable");
    expect(evidence).not.toHaveProperty("received");
  });
  it("foreign-author reserved history cannot become a local act", async () => {
    const f = await literalFixture();
    await raw(f.gw, [signed({ ...f.claims, author: PEER }, PEER_SEED)]);
    expect(localChannelEvidence(f.gw, f.ch.name).state).toBe("unavailable");
  });
  it("two current matching opens are ambiguous even with different timestamps", async () => {
    const f = await literalFixture();
    const a = signed(f.claims),
      b = signed({ ...f.claims, timestamp: 200 });
    await raw(f.gw, [a, b]);
    const evidence = localChannelEvidence(f.gw, f.ch.name);
    expect(evidence.state).toBe("unavailable");
    if (evidence.state === "unavailable")
      expect(evidence.reason).toMatch(/ambig|multiple|more than one/i);
  });
  it("exact historical status must exist but later lawful status stamps do not invalidate it", async () => {
    const { gw } = await home();
    const { ch } = await channel(gw);
    const opening = opened(gw, ch.name).opening;
    await gw.setChannel(ch.name, { blessing: false });
    expect(opened(gw, ch.name).opening.id).toBe(opening.id);
    await gw.erase(opening.statusAtOpen);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
  });
  it("a newer identical-name declaration is not the attached declaration; missing attachment never remints", async () => {
    const { gw } = await home();
    const { ch } = await channel(gw);
    const opening = opened(gw, ch.name).opening;
    const original = gw.reactor.get(opening.poolDeclaration)!;
    await gw.append([signed({ ...original.claims, timestamp: gw.nextTimestamp() })]);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    gw.channelPools.delete(ch.name);
    gw.federationChannels.delete(ch.name);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(events(gw, "open")).toHaveLength(1);
  });
});

describe("T288 explicit trusted-local event erasure and protected controls", () => {
  it("erase(received) forgets that operand contribution, preserves bystanders and marks the exact tombstone", async () => {
    const { gw } = await home();
    const { ch, pool, offering } = await channel(gw);
    const a = fact(),
      b = fact(2);
    offering.push(a);
    await ch.sync();
    const target = events(gw, "received")[0]!;
    offering.push(b);
    await ch.sync();
    const bystander = events(gw, "received").find((d) => d.id !== target.id)!;
    const report = await gw.erase(target.id, { reason: "withdraw local evidence" });
    expect(report.erased).toBe(target.id);
    expect(gw.reactor.get(target.id)).toBeUndefined();
    expect(await gw.backend.holds(target.id)).toBe(false);
    expect(gw.reactor.get(bystander.id)).toBeDefined();
    expect(ids(opened(gw, ch.name).received)).toEqual([b.id]);
    expect(pool.reactor.get(a.id)).toBeDefined();
    const tombstone = gw.reactor.get(report.tombstone)!;
    expect(ref(tombstone, "erases")).toBe(target.id);
    expect(
      tombstone.claims.pointers.filter(
        (pt) => pt.target.kind === "entity" && pt.target.entity.context === CONTROL,
      ),
    ).toEqual([e("local-control", target.id, CONTROL)]);
    expect(value(tombstone, "local-control-version")).toBe(1);
    expect(value(tombstone, "local-control-kind")).toBe("erase");
    expect(verifyDelta(tombstone)).toBe("verified");
    expect(ref(tombstone, "erases")).not.toBe(bystander.id);
    // Legitimate host fan-out must retain the same marked signed control in its attached pool.
    expect(pool.reactor.get(tombstone.id)).toEqual(tombstone);
    const forgiveness = strike(tombstone),
      forgivenessAgain = strike(forgiveness);
    await expect(gw.append([forgiveness])).rejects.toThrow();
    expect(
      (
        await gw.federate([forgivenessAgain, forgiveness], {
          ids: true,
          admittedIds: true,
          admit: () => true,
        })
      ).admittedIds,
    ).toEqual([]);
    await expect(gw.append([signed(eraseClaims(tombstone.id, OP, OP, 11000))])).rejects.toThrow();
    expect(ids(opened(gw, ch.name).received)).toEqual([b.id]);
  });
  it("erasing a received-strike event deliberately exposes earlier received source support", async () => {
    const { gw } = await home();
    const { ch, offering } = await channel(gw);
    const a = fact(),
      s = strike(a, PEER_SEED);
    offering.push(a);
    await ch.sync();
    offering.push(s);
    await ch.sync();
    expect(sourceStanding(gw, ch.name, a.id)).toBe(false);
    const receipt = events(gw, "received").find((d) =>
      d.claims.pointers.some(
        (pt) =>
          pt.role === "received" && pt.target.kind === "delta" && pt.target.deltaRef.delta === s.id,
      ),
    )!;
    await gw.erase(receipt.id);
    expect(sourceStanding(gw, ch.name, a.id)).toBe(true);
    expect(ch.pool.gateway!.reactor.get(s.id)).toBeDefined();
  });
  it("erase(open) loses incarnation without removing receipt/source/bystander; controls cannot recreate it", async () => {
    const { gw } = await home();
    const { ch, offering, pool } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    const opening = opened(gw, ch.name).opening;
    const receipt = events(gw, "received")[0]!;
    const report = await gw.erase(opening.id);
    expect(report.citations).toContain(receipt.id);
    expect(gw.reactor.get(receipt.id)).toBeDefined();
    expect(pool.reactor.get(fact().id)).toBeDefined();
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    const legacy = gw.reactor.get(opening.statusAtOpen)!;
    await gw.append([signed({ ...legacy.claims, timestamp: gw.nextTimestamp() })]);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(events(gw, "open")).toEqual([]);
  });
  it("erase(open) before any receipt is erased history, never legacy: a resumed handle cannot sync unprotected", async () => {
    const { gw } = await home();
    const { ch, offering, source } = await channel(gw);
    const opening = opened(gw, ch.name).opening;
    await gw.erase(opening.id);
    // Delta level: the opening's bytes are gone and one marker names this channel.
    expect(gw.reactor.get(opening.id)).toBeUndefined();
    expect(events(gw, "open")).toEqual([]);
    expect(
      [...gw.reactor.snapshot()].filter(
        (d) => inLocalContext(d, LOCAL_CONTROL) && localControlChannel(d) === `channel:${ch.name}`,
      ),
    ).toHaveLength(1);
    // Object level: the history is unavailable, and stays so across a cross-process resume.
    expect(localChannelEvidence(gw, ch.name)).toEqual({
      state: "unavailable",
      reason: "erased opening",
    });
    gw.federationChannels.delete(ch.name);
    const resumed = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/default",
      source,
    });
    offering.push(fact());
    await expect(resumed.sync()).rejects.toThrow("no matching protected incarnation");
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(events(gw, "received")).toEqual([]);
  });
  it("re-opening a standing channel with other options refuses before caching a handle", async () => {
    const { gw } = await home();
    const { ch, offering, source } = await channel(gw);
    const other = () =>
      gw.openChannel({
        into: "friends",
        prefix: "peer",
        from: "https://peer.example/other",
        source,
      });
    // With the handle cached, the mismatch refuses instead of handing back the cached handle.
    await expect(other()).rejects.toThrow("drop it before opening it another way");
    expect(gw.federationChannels.get(ch.name)).toBe(ch);
    // Without a live handle, the same refusal, and nothing is cached. The message names no source.
    gw.federationChannels.delete(ch.name);
    const refusal = await other().catch((e: Error) => e.message);
    expect(refusal).toContain("drop it before opening it another way");
    expect(refusal).not.toContain("peer.example");
    expect(gw.federationChannels.has(ch.name)).toBe(false);
    const same = await gw.openChannel({
      into: "friends",
      prefix: "peer",
      from: "https://peer.example/default",
      source,
    });
    offering.push(fact());
    await same.sync();
    expect(opened(gw, ch.name).received).toHaveLength(1);
  });
  it("erase(close) revives only its still-attached exact opening, never a successfully dropped pool", async () => {
    const { gw, pools } = await home();
    const { ch } = await channel(gw);
    const opening = opened(gw, ch.name).opening;
    pools.get(ch.name)!.failPurge = true;
    await expect(gw.dropChannel(ch.name)).rejects.toThrow();
    const close = events(gw, "close")[0]!;
    pools.get(ch.name)!.failPurge = false;
    await gw.erase(close.id);
    expect(opened(gw, ch.name).opening.id).toBe(opening.id);
    await gw.dropChannel(ch.name);
    const finalClose = events(gw, "close")[0]!;
    await gw.erase(finalClose.id);
    expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    expect(gw.channelPools.has(ch.name)).toBe(false);
  });
  it("failed purge's effective marked tombstone suppresses held event bytes; generic forgiveness still refuses", async () => {
    const { gw, primary } = await home();
    const { ch, offering } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    const receipt = events(gw, "received")[0]!;
    primary.failPurge = true;
    await expect(gw.erase(receipt.id)).rejects.toThrow();
    expect(gw.reactor.get(receipt.id)).toBeDefined();
    expect(await primary.holds(receipt.id)).toBe(true);
    expect(opened(gw, ch.name).received).toEqual([]);
    const tombstone = [...gw.reactor.snapshot()].find(
      (d) => inContext(d, CONTROL) && ref(d, "erases") === receipt.id,
    )!;
    expect(tombstone).toBeDefined();
    await expect(gw.append([strike(tombstone)])).rejects.toThrow();
    expect(
      (await gw.federate([strike(tombstone)], { ids: true, admittedIds: true, admit: () => true }))
        .admittedIds,
    ).toEqual([]);
    expect(opened(gw, ch.name).received).toEqual([]);
    primary.failPurge = false;
    await gw.erase(receipt.id);
    expect(gw.reactor.get(receipt.id)).toBeUndefined();
  });
  it("direct unattached eraseReplica cannot mint event deletion authority from a same-key fresh tombstone", async () => {
    const { gw } = await home();
    const { ch } = await channel(gw);
    const target = gw.reactor.get(opened(gw, ch.name).opening.id)!;
    const tombstone = markedErase(target);
    expect(gw.reactor.get(tombstone.id)).toBeUndefined();
    await expect(gw.eraseReplica(tombstone, target.id)).rejects.toThrow();
    expect(gw.reactor.get(target.id)).toBeDefined();
    expect(gw.reactor.get(tombstone.id)).toBeUndefined();
    expect(localChannelEvidence(gw, ch.name).state).toBe("open");
    // An independent replica with copied trusted fixture bytes still has no attached authority.
    const standalone = await Gateway.open(new MemoryBackend(), { seed: SEED });
    homes.push(standalone);
    await raw(standalone, [target]);
    await expect(standalone.eraseReplica(tombstone, target.id)).rejects.toThrow();
    expect(standalone.reactor.get(target.id)).toBeDefined();
  });
  it("preplanted unknown-target strike never acquires local retirement power when a receipt is minted", async () => {
    const { gw } = await home();
    const { ch, offering } = await channel(gw);
    const a = fact();
    const predicted = signed({
      ...receivedLiteral(ch.name, opened(gw, ch.name).opening.id, [a.id]),
      timestamp: 50000,
    });
    const preplant = strike(predicted, SEED, 49999);
    await gw.append([preplant]);
    expect(gw.reactor.get(preplant.id)).toBeDefined();
    vi.spyOn(gw, "nextTimestamp").mockReturnValue(50000);
    offering.push(a);
    await ch.sync();
    expect(gw.reactor.get(predicted.id)).toBeDefined();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
    await expect(gw.append([strike(preplant, SEED, 50001)])).rejects.toThrow();
    expect(ids(opened(gw, ch.name).received)).toEqual([a.id]);
  });
  it("a preplanted unknown-target tombstone prevents later issuance of that exact protected receipt ID", async () => {
    const { gw } = await home();
    const { ch, offering, pool } = await channel(gw);
    const a = fact();
    const predicted = signed({
      ...receivedLiteral(ch.name, opened(gw, ch.name).opening.id, [a.id]),
      timestamp: 50000,
    });
    const preplant = signed(eraseClaims(predicted.id, OP, OP, 49999));
    await gw.append([preplant]);
    expect(gw.reactor.get(preplant.id)).toBeDefined();
    vi.spyOn(gw, "nextTimestamp").mockReturnValue(50000);
    offering.push(a);
    await expect(ch.sync()).rejects.toThrow();
    expect(pool.reactor.get(a.id)).toBeDefined();
    expect(gw.reactor.get(predicted.id)).toBeUndefined();
    expect(opened(gw, ch.name).received).toEqual([]);
  });
  it("a preplanted strike of a future marked tombstone cannot forgive it after failed purge or trusted reopen", async () => {
    const { gw, primary } = await home();
    const { ch, pool, offering } = await channel(gw);
    offering.push(fact());
    await ch.sync();
    const firstReceipt = events(gw, "received")[0]!;
    const firstErase = await gw.erase(firstReceipt.id);
    const template = gw.reactor.get(firstErase.tombstone)!;
    // Learn only the supported writer's pointer placement, not its authority decision. The v1
    // marker's semantic shape is independently asserted in the exact-ID erase rail above.
    offering.length = 0;
    offering.push(fact(2));
    await ch.sync();
    const target = events(gw, "received")[0]!;
    const predicted = signed({
      ...template.claims,
      timestamp: 70000,
      pointers: template.claims.pointers.map((pt) =>
        pt.role === "erases"
          ? r("erases", target.id)
          : pt.role === "local-control"
            ? e("local-control", target.id, CONTROL)
            : pt,
      ),
    });
    const preplant = strike(predicted, SEED, 69999);
    await gw.append([preplant]);
    expect(gw.reactor.get(preplant.id)).toBeDefined();
    expect(gw.reactor.get(predicted.id)).toBeUndefined();
    vi.spyOn(gw, "nextTimestamp").mockReturnValue(70000);
    primary.failPurge = true;
    await expect(gw.erase(target.id)).rejects.toThrow();
    expect(gw.reactor.get(predicted.id)).toEqual(predicted);
    expect(await primary.holds(target.id)).toBe(true);
    expect(readTombstones(gw.reactor, OP).has(target.id)).toBe(true);
    expect(readTombstones(pool.reactor, OP).has(target.id)).toBe(true);
    expect(pool.reactor.get(predicted.id)).toEqual(predicted);
    expect(opened(gw, ch.name).received).toEqual([]);
    await expect(gw.append([strike(preplant, SEED, 70001)])).rejects.toThrow();
    const root = new MemoryBackend(),
      restoredPool = new MemoryBackend();
    await root.append(await primary.deltasSince(new Set()));
    await restoredPool.append(await pool.backend.deltasSince(new Set()));
    const restored = await Gateway.open(root, { seed: SEED, channelBackend: () => restoredPool });
    homes.push(restored);
    await restored.resumeChannels();
    expect(readTombstones(restored.reactor, OP).has(target.id)).toBe(true);
    expect(opened(restored, ch.name).received).toEqual([]);
    await restored.erase(target.id);
    expect(await root.holds(target.id)).toBe(false);
    expect(readTombstones(restored.reactor, OP).has(target.id)).toBe(true);
  });
  it.each(["mismatched-marker", "duplicate-marker", "unsupported-kind", "unsupported-forgiveness"])(
    "corrupted restored protected control %s yields unavailable",
    async (defect) => {
      const { gw } = await home();
      const { ch } = await channel(gw);
      const target = gw.reactor.get(opened(gw, ch.name).opening.id)!;
      let tombstone = markedErase(target);
      if (defect === "mismatched-marker")
        tombstone = signed({
          ...tombstone.claims,
          pointers: tombstone.claims.pointers.map((pt) =>
            pt.role === "local-control" ? e("local-control", fact().id, CONTROL) : pt,
          ),
        });
      if (defect === "duplicate-marker")
        tombstone = signed({
          ...tombstone.claims,
          pointers: [...tombstone.claims.pointers, e("local-control", target.id, CONTROL)],
        });
      if (defect === "unsupported-kind")
        tombstone = signed({
          ...tombstone.claims,
          pointers: tombstone.claims.pointers.map((pt) =>
            pt.role === "local-control-kind" ? p("local-control-kind", "forgive") : pt,
          ),
        });
      await raw(gw, [tombstone]);
      if (defect === "unsupported-forgiveness") await raw(gw, [strike(tombstone)]);
      expect(localChannelEvidence(gw, ch.name).state).toBe("unavailable");
    },
  );
  it("ordinary data forgiveness retains its existing behavior", async () => {
    const { gw } = await home();
    const a = fact(1, SEED),
      b = fact(2, SEED);
    await gw.append([a, b]);
    const erased = await gw.erase(a.id);
    await gw.append([strike(gw.reactor.get(erased.tombstone)!)]);
    await gw.append([a]);
    expect(gw.reactor.get(a.id)).toEqual(a);
    expect(gw.reactor.get(b.id)).toEqual(b);
  });
});

describe("T288 durable trusted history, distinct from content import", () => {
  it("SQLite restart replays exact opening/received lineage and supported event erasure solely from deltas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-t288-durable-"));
    dirs.push(dir);
    const backendFor = (name: string) =>
      new SqliteBackend(join(dir, `${encodeURIComponent(name)}.sqlite`));
    const rootFile = join(dir, "root.sqlite");
    const genesis = assembleGenesis({ operatorSeed: SEED, registrations: [] });
    const first = await Gateway.boot(new SqliteBackend(rootFile), genesis, {
      channelBackend: backendFor,
    });
    const { ch, offering } = await channel(first);
    const a = fact(),
      s = strike(a, PEER_SEED);
    offering.push(a);
    await ch.sync();
    offering.push(s);
    await ch.sync();
    const receipt = events(first, "received").find((d) => ref(d, "received") === s.id)!;
    await first.erase(receipt.id);
    const expected = opened(first, ch.name);
    const bytes = ids(events(first));
    expect(sourceStanding(first, ch.name, a.id)).toBe(true);
    await first.close();
    const second = await Gateway.boot(new SqliteBackend(rootFile), genesis, {
      channelBackend: backendFor,
    });
    homes.push(second);
    expect(opened(second, ch.name)).toEqual(expected);
    expect(ids(events(second))).toEqual(bytes);
    expect(sourceStanding(second, ch.name, a.id)).toBe(true);
    const thirdHome = (await home()).gw;
    const imported = await thirdHome.federate(await second.backend.deltasSince(new Set()), {
      ids: true,
      admittedIds: true,
      admit: () => true,
    });
    expect(imported.admittedIds).not.toContain(expected.opening.id);
    expect(events(thirdHome)).toEqual([]);
    expect(localChannelEvidence(thirdHome, ch.name)).toEqual({ state: "legacy" });
    // This explicitly does NOT claim to detect dishonest prepopulation: preserving guarded
    // whole-history bytes is trusted restoration of one logical authority, not creating a new home.
  });
  it("supported pending local erasure can finish after reopen without generic forgiveness or recovery changes", async () => {
    const original = await home();
    const { ch, offering } = await channel(original.gw);
    offering.push(fact());
    await ch.sync();
    const receipt = events(original.gw, "received")[0]!;
    original.primary.failPurge = true;
    await expect(original.gw.erase(receipt.id)).rejects.toThrow();
    const root = new MemoryBackend();
    await root.append(await original.primary.deltasSince(new Set()));
    const pool = new MemoryBackend();
    await pool.append(await ch.pool.gateway!.backend.deltasSince(new Set()));
    const restored = await Gateway.open(root, { seed: SEED, channelBackend: () => pool });
    homes.push(restored);
    await restored.resumeChannels();
    expect(opened(restored, ch.name).received).toEqual([]);
    await restored.erase(receipt.id);
    expect(await root.holds(receipt.id)).toBe(false);
    expect(opened(restored, ch.name).received).toEqual([]);
  });
});
