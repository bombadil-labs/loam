// The shipped STORE artifact, pinned (SPEC §15): `dist/browser/index.js` is a self-contained
// browser-safe ESM bundle — the whole Gateway, genesis, law, and the LocalStorageBackend,
// zero `node:` specifiers, nothing left for a bundler to resolve. The proof is a boot: genesis
// → register → claim → query, entirely inside the artifact, then a reopen from the same origin
// to show the page's deltas were really persisted. And the curation is pinned too: no serve,
// no fs-backed drivers, no CLI.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MemStorage } from "../store/mem-storage.js";

// esbuild has a whole store to inline; give the build the same generous guard the other
// heavy suites carry.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const BUNDLE = join(process.cwd(), "dist", "browser", "index.js");

// The bundle's surface, typed only as far as this suite drives it.
interface QueryResult {
  data?: Record<string, unknown> | null;
  errors?: string[];
}
interface BundleGateway {
  query(
    source: string,
    variables?: Record<string, unknown>,
    context?: { actor?: string },
  ): Promise<QueryResult>;
  close(): Promise<void>;
}
interface BrowserModule {
  Gateway: {
    boot(backend: unknown, genesis: unknown): Promise<BundleGateway>;
    open(backend: unknown, options: { seed: string }): Promise<BundleGateway>;
  };
  assembleGenesis(spec: Record<string, unknown>): unknown;
  grantClaims(entity: string, author: string, verb: string, by: string, ts: number): unknown;
  STORE_ENTITY: string;
  MemoryBackend: new () => unknown;
  LocalStorageBackend: new (store: string, storage: MemStorage) => unknown;
  parseTerm(json: unknown): unknown;
  mintSeed(): string;
  authorForSeed(seed: string): string;
  [key: string]: unknown;
}

const OPERATOR_SEED = "0e".repeat(32);
const WRITER_SEED = "a1".repeat(32);
const FERN = "plant:fern";

// A tiny governed world, assembled entirely from the bundle's own exports.
function plantGenesis(b: BrowserModule): unknown {
  const body = b.parseTerm({
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" } } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  });
  const pickLatest = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
  return b.assembleGenesis({
    operatorSeed: OPERATOR_SEED,
    registrations: [
      {
        schema: { name: "Plant", alg: 1, body },
        policy: { props: new Map([["height", pickLatest]]), default: pickLatest },
        roots: [FERN],
      },
    ],
    grants: [
      b.grantClaims(
        b.STORE_ENTITY,
        b.authorForSeed(WRITER_SEED),
        "write",
        b.authorForSeed(OPERATOR_SEED),
        2,
      ),
    ],
  });
}

beforeAll(() => {
  execFileSync(process.execPath, [join("scripts", "build-bundles.mjs"), "browser"], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
});

describe("the browser store bundle", () => {
  it("is self-contained: no node: specifiers, no imports left to resolve", () => {
    const text = readFileSync(BUNDLE, "utf8");
    expect(text).not.toMatch(/^import\s/m);
    expect(text).not.toMatch(/\brequire\(/);
    // Zero node: SPECIFIERS. graphql v17 carries one guarded runtime probe —
    // `process.getBuiltinModule("node:diagnostics_channel")` in a try/catch — which is a
    // feature detection, not an import: nothing for a bundler to resolve, inert in a page.
    for (const m of text.matchAll(/["']node:/g)) {
      expect(text.slice(Math.max(0, m.index - 30), m.index)).toMatch(/getBuiltinModule\($/);
    }
  });

  it("curates, not filters: no serve, no fs-backed drivers, no CLI", async () => {
    const b = (await import(pathToFileURL(BUNDLE).href)) as BrowserModule;
    for (const absent of ["serve", "SqliteBackend", "ArchiveBackend", "MirrorBackend", "run"]) {
      expect(b[absent], `${absent} must not ride the browser bundle`).toBeUndefined();
    }
  });

  it("boots a full store in the artifact: genesis → register → claim → query", async () => {
    const b = (await import(pathToFileURL(BUNDLE).href)) as BrowserModule;
    const gateway = await b.Gateway.boot(new b.MemoryBackend(), plantGenesis(b));

    // registered by genesis: it answers without a register() call
    const empty = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(empty.errors).toBeUndefined();

    // governed: the granted writer claims; a stranger is refused
    const claimed = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 40) { height } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(claimed.errors).toBeUndefined();
    const denied = await gateway.query(
      `mutation { plant(entity: "${FERN}", height: 99) { height } }`,
      undefined,
      { actor: "e4".repeat(32) },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);

    const answer = await gateway.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(40);
    await gateway.close();
  });

  it("persists in the page: a second boot from the same origin remembers everything", async () => {
    const b = (await import(pathToFileURL(BUNDLE).href)) as BrowserModule;
    const origin = new MemStorage();

    const first = await b.Gateway.boot(new b.LocalStorageBackend("tab", origin), plantGenesis(b));
    const claimed = await first.query(
      `mutation { plant(entity: "${FERN}", height: 62) { height } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(claimed.errors).toBeUndefined();
    await first.close();

    // The next tab: no genesis, no register() — the store remembers its own shape and facts.
    const second = await b.Gateway.open(new b.LocalStorageBackend("tab", origin), {
      seed: OPERATOR_SEED,
    });
    const answer = await second.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(answer.errors).toBeUndefined();
    expect((answer.data as { plant: { height: number } }).plant.height).toBe(62);
    await second.close();
  });

  it("mints and derives in the artifact: the client's key discipline rides along", async () => {
    const b = (await import(pathToFileURL(BUNDLE).href)) as BrowserModule;
    const seed = b.mintSeed();
    expect(seed).toMatch(/^[0-9a-f]{64}$/);
    expect(b.authorForSeed(seed)).toMatch(/^ed25519:[0-9a-f]{64}$/);
  });
});
