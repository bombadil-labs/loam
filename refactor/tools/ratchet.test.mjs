// Probes for the census ratchet: each form it claims to count must move its count. A form the
// ratchet misses is a coupling that can rise while `npm run check` stays green.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { couplingCountsOf, peerSurfaceOf } from "./lib.mjs";

const CORE = "src/gateway/probe.ts";
const count = (text, file = CORE) => couplingCountsOf(file, text);

describe("census ratchet counts", () => {
  it.each([
    ["property", "gw.options.seed;"],
    ["element", 'gw.options["seed"];'],
    ["bare receiver", "options.seed;"],
    ["destructured", "const { seed } = gw.options;"],
    ["destructured and renamed", "const { seed: s } = options;"],
  ])("counts a seed read: %s", (_, text) => {
    expect(count(text).seedReads).toBe(1);
  });

  it.each([
    ["call", "gw.reactor.snapshot();"],
    ["element call", 'gw.reactor["snapshot"]();'],
    ["reference", "const f = reactor.snapshot;"],
    ["other casing", "this.primaryReactor.snapshot();"],
  ])("counts a snapshot reference: %s", (_, text) => {
    expect(count(text).snapshotRefs).toBe(1);
  });

  it.each([
    ["Date.now()", "Date.now();"],
    ["globalThis", "globalThis.Date.now();"],
    ["element", 'Date["now"]();'],
    ["reference", "const clock = Date.now;"],
    ["performance", "performance.now();"],
    ["new Date()", "new Date();"],
    ["new globalThis.Date()", "new globalThis.Date();"],
    ["destructured", "const { now } = performance;"],
  ])("counts a core clock read: %s", (_, text) => {
    expect(count(text).coreClockReads).toBe(1);
  });

  it("counts a clock read in a core file under a Windows path", () => {
    expect(count("Date.now();", "src\\gateway\\probe.ts").coreClockReads).toBe(1);
  });

  it("does not count controls", () => {
    const text = [
      "new Date(0);",
      "other.seed;",
      "gw.options.seedHex;",
      "view.snapshot();",
      "// options.seed reactor.snapshot() Date.now()",
      'const s = "options.seed";',
    ].join("\n");
    expect(count(text)).toEqual({ seedReads: 0, snapshotRefs: 0, coreClockReads: 0, treeReach: 0 });
    expect(count("Date.now();", "src/server/probe.ts").coreClockReads).toBe(0);
  });

  it("counts each line of container code that reaches the tree as gateways, once, outside the opener and the store", () => {
    const text = [
      "gw.quarantinePools.has(p) && gw.channelPools.get(n);",
      "pool.attachedTo;",
      "gw.store.parentOf(p);",
      "gw.connectionInboxes.size;",
      "gw.attachedContainers;",
      "gw.store.tableOf(gw).pools;",
      "poolForBindingImpl(gw, binding);",
      "gw.store.pools(gw);",
      "// gw.quarantinePools",
    ].join("\n");
    expect(count(text).treeReach).toBe(7); // two members on the first line count once
    expect(count(text, "src/federation/channel.ts").treeReach).toBe(7);
    expect(count(text, "src/gateway/container.ts").treeReach).toBe(0);
    expect(count(text, "src/gateway/store.ts").treeReach).toBe(0);
    // A door or a command is a facade over one container, not a container.
    expect(count(text, "src/server/admin.ts").treeReach).toBe(0);
    expect(count(text, "src/cli/cli.ts").treeReach).toBe(0);
  });

  it("does not count the facade's own definitions, and nothing else by that name", () => {
    const text = [
      "class Gateway {",
      "  get quarantinePools() { return this.store.tableOf(this).pools; }",
      "  poolForBinding(b) { return poolForBindingImpl(this, b); }",
      "  other() { return this.store.tableOf(this).named; }",
      "}",
    ].join("\n");
    expect(count(text, "src/gateway/gateway.ts").treeReach).toBe(1);
    // The same definitions anywhere else, or on another class, are reaches like any other.
    expect(count(text).treeReach).toBe(3);
    const other = "class X { poolForBinding(b) { return this.quarantinePools.has(b); } }";
    expect(count(other).treeReach).toBe(1);
    expect(count(other, "src/gateway/gateway.ts").treeReach).toBe(1);
  });

  it("counts the members the Peer type picks, and refuses any other shape of Peer", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "census-peer-"));
    const file = path.join(dir, "src", "gateway", "peer.ts");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const surface = (text) => {
      fs.writeFileSync(file, text);
      return peerSurfaceOf([file]);
    };
    expect(surface('export type Peer = Pick<Gateway, "reactor" | "store" | "close">;\n')).toBe(3);
    expect(peerSurfaceOf([path.join(dir, "src", "gateway", "other.ts")])).toBe(0);
    for (const widened of [
      'export type Peer = Pick<Gateway, "reactor"> & { extra: Gateway["close"] };',
      'export interface Peer { reactor: Gateway["reactor"] }',
      'export type Peer = Pick<Other, "reactor">;',
      'export type Peer = Pick<Gateway, "reactor" | Keys>;',
      "export type Peer = Gateway;",
    ]) {
      expect(() => surface(widened), widened).toThrow(/must declare/);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
