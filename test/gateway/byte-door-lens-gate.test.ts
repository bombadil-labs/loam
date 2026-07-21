// §12/§17 — the anonymous byte-door must gate on the LENS it will actually resolve (ticket T42).
//
// Audit 3 found `serveBytesImpl` testing `r.hyperschema.name === fromLens` while every sibling door
// check in the same file uses `lensOf(r)`, and while resolution proceeds by LENS name against the
// whole registered set. Since §21.7 coexistence, one HyperSchema carries several readings — so the
// two names differ, and gating on the program name authorizes EVERY reading over that program,
// including ones the operator never declared. That is hazard H6.
//
// The exploit needs only a known content address: register `Plant` with a broad reading and a narrow
// one, declare ONLY the narrow one public, and ask the anonymous byte-door for `?from=<broad>`. The
// membership test passes (the narrow registration carries `hyperschema.name === "Plant"`), and the
// door then resolves the UNDECLARED broad reading, runs its §22 resolvers on the tokenless door, and
// searches its full view for the ref.
//
// BOTH LEVELS (CLAUDE.md P3). Delta level: the operator declared exactly one lens public, and that
// declaration is what the door must honour. Object level: what the door actually ANSWERS. The bug
// is invisible at the delta level — the declarations are correct throughout — which is why the door
// assertion is the load-bearing one here, and why the file says so rather than implying parity.

import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { lensOf } from "../../src/gateway/registration.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

// Two readings over ONE hyperschema. `Plant` is the private, full reading; `PlantPublic` is the
// redacted sibling the operator is willing to serve anonymously.
const FULL: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: {
    height: { pick: { order: { byTimestamp: "desc" } } },
    message: { pick: { order: { byTimestamp: "desc" } } },
  },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const REDACTED: Schema = parseSchema({
  name: "PlantPublic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: FULL, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );
  // The second reading arrives the way §21.7 coexistence actually happens — a later
  // `publishRegistration` over the SAME hyperschema, not a second genesis entry (genesis keeps one
  // registration per hyperschema, so listing both there silently yields one lens; the precondition
  // rail below exists because that is exactly how this fixture was wrong on the first attempt).
  await gw.publishRegistration(PLANT, REDACTED, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", 42, 1000, OP_SEED)]);
  // ONLY the redacted reading is offered anonymously.
  await gw.declarePublic(["PlantPublic"]);
  return gw;
};

describe("§12 — the anonymous byte-door honours the lens, not the program", () => {
  it("the two readings really do share a hyperschema name (the precondition for the bug)", async () => {
    const gw = await boot();
    // If this ever stops being true the rails below prove nothing, so assert it rather than assume:
    // both registrations carry the SAME `hyperschema.name` and DIFFERENT lens names. That gap is
    // exactly what the old gate could not see.
    const names = gw.registered.map((r) => ({ program: r.hyperschema.name, lens: lensOf(r) }));
    const plants = names.filter((n) => n.program === "Plant");
    expect(plants.length).toBeGreaterThanOrEqual(2);
    expect(new Set(plants.map((n) => n.lens)).size).toBeGreaterThanOrEqual(2);
    await gw.close();
  });

  it("an anonymous byte-door request naming an UNDECLARED reading is refused", async () => {
    const gw = await boot();
    // The attacker names the private reading. Under the old gate this passed the membership test —
    // because the PUBLIC registration's `hyperschema.name` is also "Plant" — and then resolved the
    // private reading on the tokenless door.
    const out = gw.serveBytes("anything", "Plant", FERN, "public");
    expect(out.status).toBe(404);
    await gw.close();
  });

  it("the refusal is uniform — it names no route, lens, or entity", async () => {
    const gw = await boot();
    const undeclared = gw.serveBytes("some-ref", "Plant", FERN, "public");
    const nonsense = gw.serveBytes("some-ref", "NoSuchLensAtAll", FERN, "public");
    // §12/§13: a refusal must not tell a stranger which of their guesses was closer. If the
    // undeclared-reading refusal differed from the never-existed refusal, the door would be an
    // oracle for what the operator has registered privately.
    expect(out(undeclared)).toBe(out(nonsense));
    expect(out(undeclared)).not.toContain("Plant");
    expect(out(undeclared)).not.toContain(FERN);
    await gw.close();
  });

  it("the DECLARED reading still serves — the fix must not close the door it was meant to keep open", async () => {
    const gw = await boot();
    // A missing ref through the declared lens is still a clean 404, but it must reach resolution
    // rather than being refused at the gate. Distinguishing those is what stops a "fix" that simply
    // refuses everything from passing: the declared lens must be *admitted*.
    const declared = gw.serveBytes("no-such-ref", "PlantPublic", FERN, "public");
    expect(declared.status).toBe(404);
    // The operator's own door reaches the private reading, as it always could.
    const operatorSide = gw.serveBytes("no-such-ref", "Plant", FERN, "full");
    expect(operatorSide.status).toBe(404);
    await gw.close();
  });
});

const out = (r: { body: Uint8Array }): string => new TextDecoder().decode(r.body);
