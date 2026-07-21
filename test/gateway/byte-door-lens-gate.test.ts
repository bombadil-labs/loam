// §12/§17 — the anonymous byte-door must gate on the LENS it will actually resolve (ticket T42).
//
// Audit 3 found `serveBytesImpl` testing `r.hyperschema.name === fromLens` while every sibling door
// check in the same file uses `lensOf(r)`, and while resolution proceeds by LENS name against the
// whole registered set. Since §21.7 coexistence, one HyperSchema carries several readings — so the
// two names differ, and gating on the program name authorizes EVERY reading over that program,
// including ones the operator never declared. That is hazard H6.
//
// HOW THE READINGS DIFFER, and why the first version of this file could not see the bug. A Schema
// cannot omit a property: `resolveView` covers every HView property and falls back to `schema.default`
// for any the Schema does not name, so two readings over one gather always carry the SAME FIELD SET.
// A "redacted sibling that drops a field" is not expressible. Coexisting readings differ in HOW they
// resolve — §21.7's own fixture differs by `asc` vs `desc` — and that is the lever used here: two
// bytes values observed at different times, a BROAD reading picking the newest and an ARCHIVAL one
// picking the oldest. Only the archival reading is declared public, so the newest bytes have a
// content address that is reachable through the UNDECLARED reading and through no public one. That
// gap is what makes a 200 and a 404 mean different things at this door.
//
// BOTH LEVELS (CLAUDE.md P3). Delta level: what the public surface actually BINDS —
// `surface('public').registered` through `lensOf` — deliberately NOT the declaration accessor, which
// would only prove the fixture said what it said (see the comment at the assertion). Object level:
// what the door actually SERVES — the exploit rail demands a 404 for bytes the fixture proves are otherwise
// reachable, and the admission rail demands a 200 carrying the exact declared bytes.

// UN-SKIPPED HERE, in the same change that fixes the gate — which is what the frozen version of this
// file (landed skipped in #156) said must happen. That un-skip is the ONLY edit this PR makes to a
// frozen rail, and `rails-guard --ticket T42 --base <the freeze commit>` reports exactly that one
// line rather than the undifferentiated exit 2 the combined branch produced.
//
// Why it was skipped: a rail written before its build FAILS, which is the point of writing it first,
// and a red bar may not land on main. Verified against main before freezing: 3 of 5 failed. Verified
// again here with the fix in place: 5 pass, and 3 fail again the moment the gate is reverted.

import { describe, expect, it } from "vitest";
import {
  contentAddress,
  parseSchema,
  signClaims,
  type Delta,
  type Schema,
} from "@bombadil/rhizomatic";
import { authorForSeed } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf } from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);

// Two readings over ONE hyperschema, differing the way §21.7 coexistence actually differs — by the
// order their `pick` runs, not by their field set. BROAD ("Plant") resolves `avatar` to the NEWEST
// bytes; ARCHIVAL ("PlantPublic") resolves it to the OLDEST.
const BROAD: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { avatar: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantPublic",
  alg: 1,
  props: { avatar: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});

const OLD_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // the portrait the operator will serve
const NEW_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38]); // the one only the private reading reaches

const bytesFact = (mime: string, value: Uint8Array, ts: number): Delta =>
  signClaims(
    {
      timestamp: ts,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: FERN, context: "avatar" } } },
        { role: "value", target: { kind: "bytes", mime, value } },
      ],
    },
    OP_SEED,
  );

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BROAD, roots: [FERN], writable: ["avatar"] }],
    }),
  );
  // The second reading arrives the way §21.7 coexistence actually happens — a later
  // `publishRegistration` over the SAME hyperschema, not a second genesis entry (genesis keeps one
  // registration per hyperschema, so listing both there silently yields one lens; the precondition
  // rail below exists because that is exactly how this fixture was wrong on the first attempt).
  await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
    "avatar",
  ]);
  await gw.append([bytesFact("image/png", OLD_BYTES, 1000)]);
  await gw.append([bytesFact("image/gif", NEW_BYTES, 2000)]);
  // ONLY the archival reading is offered anonymously.
  await gw.declarePublic(["PlantPublic"]);
  return gw;
};

const REF_NEW = contentAddress(NEW_BYTES);
const REF_OLD = contentAddress(OLD_BYTES);

describe("§12 — the anonymous byte-door honours the lens, not the program", () => {
  it("PRECONDITION: the two readings share a hyperschema name and resolve to DIFFERENT bytes", async () => {
    const gw = await boot();
    // Delta level — the same program, two lenses. That gap is what the old gate could not see.
    const names = gw.registered.map((r) => ({ program: r.hyperschema.name, lens: lensOf(r) }));
    const plants = names.filter((n) => n.program === "Plant");
    expect(plants.length).toBeGreaterThanOrEqual(2);
    expect(new Set(plants.map((n) => n.lens)).size).toBeGreaterThanOrEqual(2);

    // The operator declared EXACTLY the archival reading — asserted against the public SURFACE,
    // not against the declaration record. `isPublicLatest` is bare string-set membership over the
    // literal handed to `declarePublic` in this same file, so asserting it would only prove the
    // fixture said what it said; no implementation of the door could make it fail. What matters is
    // which registrations that string BINDS to, and `surface()` binds it with `lensOf` — the very
    // distinction this ticket is about. A `surface()` matching the program name would put BOTH
    // readings on the public door and pass a membership check verbatim.
    expect(gw.surface("public")?.registered.map(lensOf)).toEqual(["PlantPublic"]);

    // Object level — the readings genuinely diverge. Without this the fixture cannot express the
    // leak at all: if both lenses resolved the same bytes, the door would answer identically whether
    // it honoured the lens or the program, and no assertion below could tell the two apart.
    expect(gw.serveBytes(REF_NEW, "Plant", FERN, "full").status).toBe(200);
    expect(gw.serveBytes(REF_NEW, "PlantPublic", FERN, "full").status).toBe(404);
    await gw.close();
  });

  it("THE EXPLOIT: the anonymous door refuses bytes reachable only through an UNDECLARED reading", async () => {
    const gw = await boot();
    // The attacker names the private reading and a content address they already hold. Under the old
    // gate the membership test passed — the PUBLIC registration's `hyperschema.name` is also "Plant"
    // — the door then resolved the UNDECLARED broad reading on the tokenless door, found REF_NEW in
    // its view, and served it. The precondition above proves those bytes really are reachable that
    // way, so this 404 is a refusal and not an accident of the fixture.
    const refused = gw.serveBytes(REF_NEW, "Plant", FERN, "public");
    expect(refused.status).toBe(404);
    expect(out(refused)).toBe(UNIFORM_REFUSAL);
    await gw.close();
  });

  it("ADMISSION: the DECLARED reading still serves its bytes — a door that refuses everything fails here", async () => {
    const gw = await boot();
    // The positive leg. Without it, replacing the whole door body with an unconditional refusal
    // would pass every other assertion in this file.
    const served = gw.serveBytes(REF_OLD, "PlantPublic", FERN, "public");
    expect(served.status).toBe(200);
    expect(served.contentType).toBe("image/png");
    expect([...served.body]).toEqual([...OLD_BYTES]);
    await gw.close();
  });

  it("the refusal is uniform — undeclared and never-existed are indistinguishable in every field", async () => {
    const gw = await boot();
    const undeclared = gw.serveBytes(REF_NEW, "Plant", FERN, "public");
    const nonsense = gw.serveBytes(REF_NEW, "NoSuchLensAtAll", FERN, "public");
    // §12/§13: a refusal must not tell a stranger which of their guesses was closer, or the door is
    // an oracle for what the operator has registered privately. Compare the WHOLE tuple, not just
    // the body — a differentiated status would be just as much of an oracle.
    expect({ ...undeclared, body: [...undeclared.body] }).toEqual({
      ...nonsense,
      body: [...nonsense.body],
    });
    // Pinned as an exact constant rather than as two negations: the whole-tuple equality above
    // already fails on any body that echoes the caller's lens or entity, so `not.toContain` could
    // not fail while it passed. This states the no-oracle contract independently instead.
    expect(out(undeclared)).toBe(UNIFORM_REFUSAL);
    await gw.close();
  });

  it("the operator's own door still reaches the private reading, as it always could", async () => {
    const gw = await boot();
    const operatorSide = gw.serveBytes(REF_NEW, "Plant", FERN, "full");
    expect(operatorSide.status).toBe(200);
    expect([...operatorSide.body]).toEqual([...NEW_BYTES]);
    await gw.close();
  });
});

const out = (r: { body: Uint8Array }): string => new TextDecoder().decode(r.body);

// The single refusal body `serveBytesImpl` produces for every failure path (§12: one silence).
const UNIFORM_REFUSAL = "no such bytes";
