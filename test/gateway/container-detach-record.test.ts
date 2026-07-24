// T32 — the detach record: T72's named deferral, fulfilled (criteria 9 and 23). detach() on a
// NAMED container lands an operator-signed claim at loam.container.detached (with the caller's
// note — where the store lives is knowledge only the caller holds); reattach negates EVERY
// surviving record (H4: one negation must not leave the container half-listed); a reader lists
// the currently-detached from the ground alone; and the note is validated like a name. Forgetting
// is two-part, IN ORDER: erasing the record while the declaration stands is the named fault the
// completeness guard reports; striking the declaration first leaves completeness unimpeded.
// (This is a NEW file on purpose — T72's pool-drop-detach rails are frozen.)

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { MemoryBackend } from "../../src/store/memory.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { containerClaims, detachClaims } from "../../src/gateway/container.js";
import { isSuppressed, retraction } from "./narrowing.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "3b".repeat(32);
const OP = authorForSeed(OP_SEED);

const boot = (backend?: MemoryBackend): Promise<Gateway> =>
  Gateway.boot(
    backend ?? new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );

const declareWall = (name: string, ts: number) =>
  signClaims(
    containerClaims({ container: name, trust: "untrusted", posture: "wall" }, OP, ts),
    OP_SEED,
  );

describe("T32 criterion 9 — the record lands, lists, and never half-clears", () => {
  it("detach() lands the record with its note, and a reader lists it from the ground alone", async () => {
    const backend = new MemoryBackend();
    const gw = await boot(backend);
    await gw.append([declareWall("container:suspect", 20_000)]);
    const c = await gw.openContainer({ name: "container:suspect", backend: new MemoryBackend() });
    await c.detach("parked at /var/loam/suspect.db pending review");

    const records = gw.containers().detached.get("container:suspect");
    expect(records).toBeDefined();
    expect(records!.some((r) => /pending review/.test(r.note ?? ""))).toBe(true);

    // From the ground ALONE: a second gateway over the same store lists it too — no session
    // memory involved, which is the whole point of an at-rest record.
    const reader = await Gateway.open(backend, { seed: OP_SEED });
    expect(reader.containers().detached.has("container:suspect")).toBe(true);
    await gw.close();
  });

  it("TWO detach records accrue and ONE reattach negates BOTH (H4)", async () => {
    const gw = await boot();
    await gw.append([declareWall("container:twice", 21_000)]);
    const wallStore = new MemoryBackend();
    const c = await gw.openContainer({ name: "container:twice", backend: wallStore });
    await c.detach("first parking");
    // The second record arrives as the operator's own append — another device, another session.
    const second = signClaims(
      detachClaims("container:twice", "second parking", OP, 21_100),
      OP_SEED,
    );
    await gw.append([second]);
    const standing = gw.containers().detached.get("container:twice");
    expect(standing?.length).toBe(2);
    const recordIds = standing!.map((r) => r.id);

    // ONE reattach clears the listing by negating EVERY surviving record. (A fresh backend:
    // detach closed the old handle, and H4 is about the records, not the store's identity.)
    const back = await gw.openContainer({ name: "container:twice", backend: new MemoryBackend() });
    // Ground level: both records are struck (surviving negations present for each).
    for (const id of recordIds) expect(isSuppressed(gw, id)).toBe(true);
    // Listing level: the container is absent — not half-listed.
    expect(gw.containers().detached.has("container:twice")).toBe(false);
    await back.drop();
    await gw.close();
  });

  it("the note is bounded: oversized or NUL-bearing notes refuse, at door and call alike", async () => {
    const gw = await boot();
    await gw.append([declareWall("container:bounded", 22_000)]);
    const oversized = "x".repeat(257);
    await expect(
      gw.append([signClaims(detachClaims("container:bounded", oversized, OP, 22_100), OP_SEED)]),
    ).rejects.toThrow(/256/);
    await expect(
      gw.append([
        signClaims(detachClaims("container:bounded", "nul\u0000note", OP, 22_200), OP_SEED),
      ]),
    ).rejects.toThrow(/NUL/);
    const c = await gw.openContainer({ name: "container:bounded", backend: new MemoryBackend() });
    await expect(c.detach(oversized)).rejects.toThrow(/256/);
    await gw.close();
  });
});

describe("T32 criterion 23 — forgetting is two-part, in order", () => {
  it("erasing the record while the declaration stands is the guard's named fault", async () => {
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    await gw.append([declareWall("container:lost", 23_000)]);
    const record = signClaims(detachClaims("container:lost", "the disk died", OP, 23_100), OP_SEED);
    await gw.append([record]);
    // Covered: an erase completes, the wall listed as deliberately kept.
    await expect(gw.erase(fact.id)).resolves.toMatchObject({ kept: ["container:lost"] });

    // The WRONG order: erase the record while the declaration still stands. The record still
    // covers the wall when this erase begins, so the erase itself completes — and every erase
    // AFTER it finds a declared wall with no cover: the named fault, exactly as §27.7 states it.
    await expect(gw.erase(record.id)).resolves.toMatchObject({ kept: ["container:lost"] });
    const fact2 = observed(FERN, "height", 31, 2000, OP_SEED);
    await gw.append([fact2]);
    await expect(gw.erase(fact2.id)).rejects.toThrow(/container:lost/);
    await gw.close();
  });

  it("striking the declaration THEN clearing the record leaves completeness unimpeded", async () => {
    const gw = await boot();
    const fact = observed(FERN, "height", 30, 1000, OP_SEED);
    await gw.append([fact]);
    const declaration = declareWall("container:written-off", 24_000);
    await gw.append([declaration]);
    const record = signClaims(
      detachClaims("container:written-off", "permanently lost", OP, 24_100),
      OP_SEED,
    );
    await gw.append([record]);

    // The honest forget, in order: strike the declaration (the container leaves the table)...
    await gw.append([retraction(declaration.id, OP, OP_SEED, 24_200)]);
    expect(gw.containers().containers.has("container:written-off")).toBe(false);
    // ...THEN clear the record. Nothing dangles beyond the operator's own say-so.
    await gw.append([retraction(record.id, OP, OP_SEED, 24_300)]);
    expect(gw.containers().detached.has("container:written-off")).toBe(false);

    const verdict = await gw.erase(fact.id);
    expect(verdict.erased).toBe(fact.id);
    expect(verdict.kept).toEqual([]); // the table is clean — nothing kept, nothing faulted
    await gw.close();
  });
});
