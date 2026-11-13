import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { overlay } from "../helpers/faultable-backend.js";
import { inPoolVoice } from "../helpers/pool-voice.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5d".repeat(32);
const NESTED_MARKER = "NESTED-POOL-CANARY-a41c88";
const SIBLING_MARKER = "SIBLING-BYSTANDER-CANARY-b52d99";
const PRIMARY_MARKER = "PRIMARY-BYSTANDER-CANARY-c63eaa";

const tmp = mkdtempSync(join(tmpdir(), "loam-drop-nested-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

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

describe("T162: drop() on an intermediate container discards the whole subtree, at the bytes", () => {
  it("a nested pool's durable store is EMPTY after the intermediate's drop — and the sibling and primary keep theirs", async () => {
    const gw = await boot();
    const primaryNote = observed(FERN, "note", PRIMARY_MARKER, 1000, OP_SEED);
    const siblingNote = observed(FERN, "note", SIBLING_MARKER, 1001, OP_SEED);
    await gw.append([primaryNote, siblingNote]);

    const siblingPath = join(tmp, "sibling.db");
    const sibling = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new SqliteBackend(siblingPath),
    });

    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const nestedPath = join(tmp, "nested.db");
    const nested = await mid.gateway!.openQuarantine({ backend: new SqliteBackend(nestedPath) });
    const secret = inPoolVoice(
      nested.gateway,
      observed(FERN, "note", NESTED_MARKER, 1002, OP_SEED),
    );
    await nested.gateway.append([secret]);
    expect(await nested.gateway.backend.holds(secret.id)).toBe(true);

    await mid.drop();

    const reopened = new SqliteBackend(nestedPath);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(nestedPath).includes(Buffer.from(NESTED_MARKER))).toBe(false);

    expect(await sibling.gateway!.backend.holds(siblingNote.id)).toBe(true);
    expect(sibling.members().some((d) => d.id === siblingNote.id)).toBe(true);
    expect(await gw.backend.holds(primaryNote.id)).toBe(true);
    expect(gw.reactor.has(primaryNote.id)).toBe(true);

    await sibling.detach();
    expect(readFileSync(siblingPath).includes(Buffer.from(SIBLING_MARKER))).toBe(true);
    await gw.close();
  });

  it("the discard is TRANSITIVE — a grandchild pool two levels beneath the drop is emptied too", async () => {
    const gw = await boot();
    const bystander = observed(FERN, "height", 30, 2000, OP_SEED);
    await gw.append([bystander]);
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const child = await mid.gateway!.openQuarantine({ backend: new MemoryBackend() });
    const grandPath = join(tmp, "grandchild.db");
    const grand = await child.gateway.openQuarantine({ backend: new SqliteBackend(grandPath) });
    const secret = inPoolVoice(grand.gateway, observed(FERN, "note", NESTED_MARKER, 2001, OP_SEED));
    await grand.gateway.append([secret]);

    await mid.drop();

    const reopened = new SqliteBackend(grandPath);
    expect(await reopened.holds(secret.id)).toBe(false);
    expect(await reopened.deltasSince(new Set())).toEqual([]);
    await reopened.close();
    expect(readFileSync(grandPath).includes(Buffer.from(NESTED_MARKER))).toBe(false);
    expect(await gw.backend.holds(bystander.id)).toBe(true);
    expect(gw.reactor.has(bystander.id)).toBe(true);
    await gw.close();
  });

  it("a nested store that cannot prove discard refuses the WHOLE drop, naming the nested pool, and the tree stays attached", async () => {
    const gw = await boot();
    const note = observed(FERN, "note", SIBLING_MARKER, 3000, OP_SEED);
    await gw.append([note]);
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const kept = new Set<string>();
    const inner = new MemoryBackend();
    const keepOne = overlay(inner, {
      purge: async (ids) => inner.purge([...ids].filter((id) => !kept.has(id))),
    });
    const nested = await mid.gateway!.openQuarantine({ backend: keepOne });
    const secret = inPoolVoice(
      nested.gateway,
      observed(FERN, "note", NESTED_MARKER, 3001, OP_SEED),
    );
    kept.add(secret.id);
    await nested.gateway.append([secret]);

    await expect(mid.drop()).rejects.toThrow(/drop refused:.*nested pool/s);

    expect(gw.quarantinePools.has(mid.gateway!)).toBe(true);
    expect(mid.gateway!.quarantinePools.has(nested.gateway)).toBe(true);
    expect(await inner.holds(secret.id)).toBe(true);
    expect(await gw.backend.holds(note.id)).toBe(true);
    const rows = gw.envelopeReports();
    expect(rows.some((r) => r.pool === "anonymous#1/anonymous#1")).toBe(true);
    await expect(mid.drop()).rejects.toThrow(/still holds/);
    expect(await inner.holds(secret.id)).toBe(true);
    await gw.close();
  });

  it("when the SECOND nested store refuses, the refusal names the first as already emptied — and a re-run completes", async () => {
    const gw = await boot();
    const note = observed(FERN, "note", PRIMARY_MARKER, 4000, OP_SEED);
    await gw.append([note]);
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });
    const first = await mid.gateway!.openQuarantine({ backend: new MemoryBackend() });
    const kept = new Set<string>();
    const inner = new MemoryBackend();
    let retain = true;
    const flaky = overlay(inner, {
      purge: async (ids) => inner.purge(retain ? [...ids].filter((id) => !kept.has(id)) : [...ids]),
      close: () => Promise.resolve(),
    });
    const second = await mid.gateway!.openQuarantine({ backend: flaky });
    const secret = inPoolVoice(
      second.gateway,
      observed(FERN, "note", NESTED_MARKER, 4001, OP_SEED),
    );
    kept.add(secret.id);
    await second.gateway.append([secret]);

    const failure = await mid.drop().then(
      () => undefined,
      (err: unknown) => err as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure!.message).toMatch(/^drop refused:/);
    expect(failure!.message).toContain("already emptied");
    expect(failure!.message).toContain('"anonymous#1/anonymous#1"');
    expect(failure!.message).not.toContain("detach() to keep it deliberately");
    expect(gw.quarantinePools.has(mid.gateway!)).toBe(true);
    expect(mid.gateway!.quarantinePools.has(first.gateway)).toBe(true);
    expect(mid.gateway!.quarantinePools.has(second.gateway)).toBe(true);
    expect(await inner.holds(secret.id)).toBe(true);

    retain = false;
    await mid.drop();
    expect(await inner.holds(secret.id)).toBe(false);
    expect(await gw.backend.holds(note.id)).toBe(true);
    await gw.close();
  });

  it("a nested pool cannot take an ANCESTOR's or a SIBLING's store — refused by name, nothing purged", async () => {
    const gw = await boot();
    const note = observed(FERN, "note", PRIMARY_MARKER, 5000, OP_SEED);
    await gw.append([note]);
    const sibBackend = new MemoryBackend();
    const sibling = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: sibBackend,
    });
    expect(sibling.posture).toBe("separate");
    const mid = await gw.openContainer({
      trust: "curated",
      posture: "separate",
      backend: new MemoryBackend(),
    });

    await expect(mid.gateway!.openQuarantine({ backend: gw.backend })).rejects.toThrow(
      /already inside this tree/,
    );
    await expect(mid.gateway!.openQuarantine({ backend: sibBackend })).rejects.toThrow(
      /already inside this tree/,
    );
    expect(await gw.backend.holds(note.id)).toBe(true);
    expect(await sibBackend.holds(note.id)).toBe(true);
    await gw.close();
  });
});
