// T66 — a corrupt row that SQUATS on its id is replaceable from a healthy copy (§25 recovery).
//
// A quarantined negation revives its target: the strike is set aside, so a reader resolves the
// retracted claim as LIVE (H1). T57 made that revival LOUD; this is the settling. The row squats
// because `deltas.id` is UNIQUE and append is `INSERT OR IGNORE`, so `heal` — which already holds
// the archive's healthy copy of exactly that id in `replant` — inserts nothing, reports 0, and hands
// back a report indistinguishable from a healthy one. That last part is H7 verbatim.
//
// WHAT THESE RAILS ASSERT, AT BOTH LEVELS.
//   - Delta/bytes: the primary's ROW for the squatted id, read back through a raw better-sqlite3
//     SELECT — the healthy claims and signature, not merely "heal said so".
//   - Object/reader: a gateway booted over the healed primary ALONE, through `narrowing.ts`'s
//     `assertPreservesSuppression` (is the claim still struck for a READER?) and through a
//     Schema-resolved View (`query`), because the negation index is the middle, not the top.
//   - TWO-SIDED, always: every recovery case also names a live BYSTANDER row and proves it survived
//     byte-for-byte and still resolves LIVE. A rail that only proved the repair could not see
//     collateral damage, which is the failure that matters most here.
//   - The negative direction: an ADMITTED row is never replaced — not by a forgery, and not by an
//     unsigned twin of itself, which `verifyDelta` calls "unsigned" rather than "invalid" and which
//     would therefore be a signature DOWNGRADE wearing a repair's clothes.
//
// WHAT THEY DELIBERATELY DO NOT ASSERT. The corrupt row's old bytes are not scrubbed from the WAL
// or a freed page after the in-place UPDATE. That is deliberate parity with `discardRow`: a
// quarantined row is not a lawful fact in the ground (§25), so removing it carries no §11
// completeness claim. THE RAIL that would close it, if that ever changes: assert
// `strings <store>.db*` no longer yields the corrupt preview after a restore.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterAll, describe, expect, it, vi } from "vitest";
import { authorForSeed, claimsToJson, makeDelta, type Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../../src/store/backend.js";
import { DELTA_ID, DELTA_ID_LENGTH, type RepairableBackend } from "../../src/store/quarantine.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { MirrorBackend } from "../../src/store/mirror.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { assertPreservesSuppression, retraction } from "../gateway/narrowing.js";
import { FERN, observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 20000 });

const OP_SEED = "3d".repeat(32);
const OP = authorForSeed(OP_SEED);

// The world every recovery case runs in: one claim, the strike that retracts it, and a BYSTANDER
// claim in a different context that must come through untouched.
const height = observed(FERN, "height", 30, 1000, OP_SEED);
const bystander = observed(FERN, "tag", "shade", 1500, OP_SEED);
const strike = retraction(height.id, OP, OP_SEED, 2000);

const GENESIS = () =>
  assembleGenesis({
    operatorSeed: OP_SEED,
    registrations: [
      { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
    ],
  });

const tmp = mkdtempSync(join(tmpdir(), "loam-t66-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;
const freshDir = (): string => join(tmp, `w-${n++}`);

interface Row {
  readonly claims: string;
  readonly sig: string | null;
}

// Read a row exactly as it sits in the table — the byte level, behind the seam.
function rowOf(path: string, id: string): Row | undefined {
  const db = new Database(path, { readonly: true });
  try {
    return db.prepare("SELECT claims, sig FROM deltas WHERE id = ?").get(id) as Row | undefined;
  } finally {
    db.close();
  }
}

// Corrupt a row's SIGNATURE in the primary only. The claims still parse, so the driver can read the
// row's `negates` ref — the T57 disclosure shape, and the one a healthy copy can repair.
function corruptSig(path: string, id: string): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), id);
  db.close();
}

// Corrupt a row's CLAIMS into bytes that are not JSON at all — the `unparseable` pen reason, the one
// that cannot even name the strike it stranded. The row is still a squatter and a healthy copy must
// still be able to take its place.
function corruptClaims(path: string, id: string): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ? WHERE id = ?").run("{not json at all", id);
  db.close();
}

// A primary + on-disk archive holding the whole healthy world, then closed. Returns their paths.
async function plantedPair(): Promise<{ path: string; vault: string }> {
  const dir = freshDir();
  const path = join(dir, "store.sqlite");
  const vault = join(dir, "archive");
  const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
  const gw = await Gateway.boot(store, GENESIS());
  await gw.append([height, bystander, strike]);
  await gw.close();
  return { path, vault };
}

// Repair the row under `id` out of band — a second handle's write, from this handle's point of view.
function healRowOutOfBand(path: string, d: Delta): void {
  const db = new Database(path);
  db.prepare("UPDATE deltas SET claims = ?, sig = ? WHERE id = ?").run(
    JSON.stringify(claimsToJson(d.claims)),
    d.sig ?? null,
    d.id,
  );
  db.close();
}

// A gateway over the HEALTHY world, for the source side of the suppression rail.
const healthySource = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(new MemoryBackend(), GENESIS());
  await gw.append([height, bystander, strike]);
  return gw;
};

describe("T66: heal replaces a corrupt row from the mirror's healthy copy", () => {
  it("the squatted negation is REPLACED, the strike is restored, and the bystander is untouched", async () => {
    const { path, vault } = await plantedPair();
    const before = rowOf(path, bystander.id);
    corruptSig(path, strike.id);
    // The premise: the corrupt row really does squat, and the strike really is stranded.
    expect(rowOf(path, strike.id)?.sig).not.toBe(strike.sig);

    // THE PRE-REPAIR STATE, at the object level — the premise every other rail in this file rests on.
    // A squatted strike means a READER resolves the retracted claim as LIVE; asserting only the bytes
    // would leave "the corruption actually stranded the strike" unproven, and an implementation where
    // it never did would pass the post-heal assertions too.
    const before2 = await Gateway.boot(new SqliteBackend(path), GENESIS());
    const sick = await before2.query(`{ plant(entity: "${FERN}") { height } }`);
    expect((sick.data?.plant as { height: unknown }).height).toBe(30); // retracted, and serving
    await before2.close();

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    // Before any heal, the surface is UNDEFINED, not an empty pair — "nobody asked" must not read as
    // "nothing was corrupt" (H9), and here something demonstrably is.
    expect(store.lastRestore).toBeUndefined();
    await store.heal();
    await store.close();

    // (a) DELTA LEVEL — the primary's own bytes now ARE the healthy copy, and heal says which id.
    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] });
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig);
    expect(rowOf(path, strike.id)?.claims).toBe(JSON.stringify(claimsToJson(strike.claims)));
    // TWO-SIDED: the live bystander's row is byte-identical to what it was before the heal.
    expect(rowOf(path, bystander.id)).toEqual(before);

    // (b) OBJECT LEVEL — what a READER resolves over the healed primary alone (no mirror: the
    // repair must live in the primary's bytes, not in the combinator).
    const source = await healthySource();
    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    assertPreservesSuppression({
      what: "heal replanting a healthy negation over a corrupt row",
      source,
      destination: dest,
      struckClaim: height.id,
    });
    // ...and the TOP level, a Schema-resolved View: the retracted height RESOLVES TO NULL (30 is
    // what a stranded strike serves), and the bystander still resolves live. A rail that only asked
    // the negation index would stop one level short.
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect(view.errors).toBeUndefined();
    const plant = view.data?.plant as { height: unknown; tag: unknown };
    expect(plant.height).toBeNull();
    expect(plant.tag).toEqual(["shade"]);
    await dest.close();
    await source.close();
  });

  it("an UNPARSEABLE row is a squatter too — the pen reason that cannot name its own strike", async () => {
    // The `unparseable` case is the one T57's disclosure can only caution about, because there are no
    // claims to read a `negates` ref out of. It is also the one an implementation that judged the
    // existing row by "does it parse" rather than "does it ADMIT" would silently refuse to repair.
    const { path, vault } = await plantedPair();
    const before = rowOf(path, bystander.id);
    corruptClaims(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal();
    await store.close();

    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] });
    expect(rowOf(path, strike.id)?.claims).toBe(JSON.stringify(claimsToJson(strike.claims)));
    expect(rowOf(path, bystander.id)).toEqual(before);

    const source = await healthySource();
    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    assertPreservesSuppression({
      what: "heal replacing an UNPARSEABLE row from the archive",
      source,
      destination: dest,
      struckClaim: height.id,
    });
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    expect((view.data?.plant as { height: unknown }).height).toBeNull();
    expect((view.data?.plant as { tag: unknown }).tag).toEqual(["shade"]);
    await dest.close();
    await source.close();
  });

  it("a genuinely-new archive delta still federates in the SAME heal that repairs a corrupt row", async () => {
    // `fromMirror` is a MIXED set — a squatted id AND deltas the primary never held. Both paths must
    // run: `append(replant)` plants the new fact, `restoreQuarantined` replaces the squatter. This is
    // the rail that fails if the restore were wired in PLACE of the append rather than beside it.
    const { path, vault } = await plantedPair();
    const arrival = observed(FERN, "tag", "fronds", 1600, OP_SEED);
    const cold = new ArchiveBackend(vault);
    await cold.append([arrival]); // the archive alone holds it
    await cold.close();
    corruptSig(path, strike.id);

    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    const report = await store.heal();
    await store.close();

    expect(store.lastRestore).toEqual({ restored: [strike.id], stranded: [], replantWithheld: [] }); // squatter replaced
    expect(report.toPrimary).toBe(1); // ...and the new fact was PLANTED, not restored
    expect(rowOf(path, arrival.id)?.sig).toBe(arrival.sig);

    const dest = await Gateway.boot(new SqliteBackend(path), GENESIS());
    const view = await dest.query(`{ plant(entity: "${FERN}") { height tag } }`);
    const plant = view.data?.plant as { height: unknown; tag: unknown };
    expect(plant.tag).toEqual(["shade", "fronds"]); // the new fact joined the bystander
    expect(plant.height).toBeNull(); // ...and the restored strike still suppresses
    await dest.close();
  });

  it("a healthy pair heals SILENTLY and stays idempotent — the mechanism never fires on its own", async () => {
    const { path, vault } = await plantedPair();
    const store = new MirrorBackend(new SqliteBackend(path), new ArchiveBackend(vault));
    await store.heal();
    // A heal HAS run, so the pair is a claim and not a default: nothing was corrupt, and nothing was
    // left corrupt. A rail asserting only `restored` could pass while the mechanism fired constantly.
    expect(store.lastRestore).toEqual({ restored: [], stranded: [], replantWithheld: [] });
    const second = await store.heal();
    expect(store.lastRestore).toEqual({ restored: [], stranded: [], replantWithheld: [] });
    expect(second.toPrimary).toBe(0);
    await store.close();
  });
});

describe("T66: the fixed-width id assumption heal's candidate match rests on", () => {
  it("DELTA_ID_LENGTH is a real delta id's length, and DELTA_ID accepts it", () => {
    // heal recovers an id from a pen key by taking a fixed-width suffix instead of asking every
    // candidate whether some key ends with it (H8: never `replant × penned`). That arithmetic is only
    // correct while ids really are that width, so the constant is pinned against actual deltas rather
    // than trusted. If a substrate change ever widens an id, this fails before the match goes subtly
    // wrong — a suffix one character short would match nothing and silently strand every squatter.
    for (const d of [height, bystander, strike]) {
      expect(d.id).toHaveLength(DELTA_ID_LENGTH);
      expect(DELTA_ID.test(d.id)).toBe(true);
      expect(d.id.slice(-DELTA_ID_LENGTH)).toBe(d.id); // a bare row id is its own suffix
      expect(`loam:garden:${d.id}`.slice(-DELTA_ID_LENGTH)).toBe(d.id); // ...so is an embedded one
    }
  });
});

describe("T66: an ADMITTED row is never replaced, and damage is never laundered inward", () => {
  it("an UNSIGNED twin of a healthy signed row is refused — a repair is not a signature downgrade", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const store = new SqliteBackend(path);
    await store.append([height, bystander]);
    // Same claims, no signature: `verifyDelta` answers "unsigned", NOT "invalid", so this delta
    // ADMITS on its own. Only the "existing row already admits" check stands between it and a
    // verified fact stripped back to an unsigned one — and the ids are identical, because a content
    // address hashes the claims and not the signature.
    const unsigned = makeDelta(height.claims);
    expect(unsigned.id).toBe(height.id);
    expect(unsigned.sig).toBeUndefined();

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);
    await store.close();
    expect(rowOf(path, height.id)?.sig).toBe(height.sig);
    // TWO-SIDED: the bystander was never in the call and is untouched either way.
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("an incoming delta that does not itself ADMIT never overwrites the corrupt row it names", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const store = new SqliteBackend(path);
    await store.append([height, bystander, strike]);
    await store.close();
    corruptSig(path, strike.id);
    const corrupt = rowOf(path, strike.id);

    const reopened = new SqliteBackend(path);
    // (a) an id that does not recompute from its claims — a forgery wearing the squatted id.
    const forged: Delta = { ...strike, claims: bystander.claims };
    // (b) an id that recomputes, carrying a signature that does not verify.
    const badSig: Delta = { ...strike, sig: "cd".repeat(64) };
    expect(await reopened.restoreQuarantined([forged, badSig])).toEqual([]);
    await reopened.close();

    // The corrupt row's bytes are exactly as they were: refused, never half-written.
    expect(rowOf(path, strike.id)).toEqual(corrupt);
    // TWO-SIDED: the healthy bystander is untouched by the refused call.
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("judges the existing row from the TABLE, not from its own pen — the stale-pen window", async () => {
    const dir = freshDir();
    const path = join(dir, "store.sqlite");
    const seeded = new SqliteBackend(path);
    await seeded.append([height, bystander, strike]);
    await seeded.close();
    corruptSig(path, strike.id);

    const store = new SqliteBackend(path);
    await store.deltasSince(new Set()); // fills THIS handle's pen with the corrupt row
    expect((await store.quarantine()).map((r) => r.key)).toEqual([strike.id]);
    // ...then the row is repaired out of band, as a second handle would. The pen this handle holds is
    // now a LIE, and an implementation that trusted it would overwrite an ADMITTED row. The incoming
    // delta is the UNSIGNED twin, so a wrong replace is visible AT REST as well as in the return: it
    // would strip the signature the other handle just restored.
    healRowOutOfBand(path, strike);
    const unsigned = makeDelta(strike.claims);

    expect(await store.restoreQuarantined([unsigned])).toEqual([]);
    await store.close();
    expect(rowOf(path, strike.id)?.sig).toBe(strike.sig); // the signature survived the stale pen
    expect(rowOf(path, bystander.id)?.sig).toBe(bystander.sig);
  });

  it("a row that is not there is not INSERTED — restore replaces, it never plants", async () => {
    const dir = freshDir();
    const store = new SqliteBackend(join(dir, "store.sqlite"));
    await store.append([height]);
    // `strike` was never appended. Restore is for a squatter, and there is none; planting a missing
    // delta is `append`'s job, so this must report nothing rather than quietly widening.
    expect(await store.restoreQuarantined([strike])).toEqual([]);
    expect(await store.holds(strike.id)).toBe(false);
    await store.close();
  });
});

describe("T66: heal REPORTS a restore it could not make, rather than reporting success", () => {
  // A repairable primary whose origin bytes keep one row set aside on every walk: `deltasSince`
  // never returns it, `quarantine()` always names it. That is what makes the mirror's copy land in
  // heal's `replant` — the squatting shape, with the driver's own storage abstracted away.
  const pennedPrimary = (
    inner: StoreBackend,
    pennedId: string,
    restore?: (deltas: Iterable<Delta>) => Promise<readonly string[]>,
  ): RepairableBackend => ({
    append: (d) => inner.append(d),
    deltasSince: async (k) => (await inner.deltasSince(k)).filter((d) => d.id !== pennedId),
    purge: (ids) => inner.purge(ids),
    holds: (id) => inner.holds(id),
    close: () => inner.close(),
    quarantine: () =>
      Promise.resolve([{ key: pennedId, reason: "invalid-signature" as const, preview: "…" }]),
    discardRow: () => Promise.resolve(false),
    ...(restore === undefined ? {} : { restoreQuarantined: restore }),
  });

  const withMirror = async (primary: RepairableBackend): Promise<MirrorBackend> => {
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]); // the archive's memory is healthy
    return new MirrorBackend(primary, vault);
  };

  it("a driver with NO restore capability is named, not silently skipped", async () => {
    const inner = new MemoryBackend();
    await inner.append([height, bystander]);
    const store = await withMirror(pennedPrimary(inner, strike.id));

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });

  it("a driver that CLAIMS a restore the pen contradicts is refused — the return value is not the verdict", async () => {
    const inner = new MemoryBackend();
    await inner.append([height, bystander]);
    // "Replaced it" — and the pen keeps naming the row on the next walk, so nothing changed. The
    // H7 shape: a success reported over work that did not land.
    const store = await withMirror(
      pennedPrimary(inner, strike.id, () => Promise.resolve([strike.id])),
    );

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([]); // heal's verdict, not the driver's word
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });

  it("a driver that repairs ONE id and mis-reports another is SPLIT across the two lists", async () => {
    // Neither list may be a pass-through of the return value. The double claims both ids; only one
    // of them actually rejoins the admitted read, so exactly one lands in each list.
    const inner = new MemoryBackend();
    await inner.append([bystander]);
    const penned = new Set([height.id, strike.id]);
    const repaired = new Set<string>();
    const primary: RepairableBackend = {
      append: (d) => inner.append(d),
      deltasSince: async (k) =>
        (await inner.deltasSince(k)).filter((d) => !penned.has(d.id) || repaired.has(d.id)),
      purge: (ids) => inner.purge(ids),
      holds: (id) => inner.holds(id),
      close: () => inner.close(),
      quarantine: () =>
        Promise.resolve(
          [...penned]
            .filter((id) => !repaired.has(id))
            .map((id) => ({ key: id, reason: "invalid-signature" as const, preview: "…" })),
        ),
      discardRow: () => Promise.resolve(false),
      restoreQuarantined: async (deltas) => {
        // Really repairs `height` (its bytes land and the read admits it); merely CLAIMS `strike`.
        await inner.append([...deltas].filter((d) => d.id === height.id));
        repaired.add(height.id);
        return [height.id, strike.id];
      },
    };
    const vault = new MemoryBackend();
    await vault.append([height, bystander, strike]);
    const store = new MirrorBackend(primary, vault);

    await store.heal();

    expect(store.lastRestore?.restored).toEqual([height.id]);
    expect(store.lastRestore?.stranded.length).toBe(1);
    expect(store.lastRestore?.stranded[0]).toContain(strike.id);
    await store.close();
  });
});
