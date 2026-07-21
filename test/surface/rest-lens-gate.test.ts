// §17/§21.7 — the REST door's warm-path test must name the LENS, not the program (ticket T42's
// second site, `servesLive` in surface/rest.ts).
//
// The byte-door's sibling. `servesLive` decides whether a versioned read answers through the door's
// LIVE surface or through pinned resolution, and it asked `r.hyperschema.name === schemaName` while
// every path around it names the lens.
//
// WHAT THE BUG ACTUALLY DID, corrected after an independent audit read the first draft of this file.
// `lensOf(r)` is `r.lensName ?? r.hyperschema.name`, so a lens whose name COINCIDES with its
// hyperschema's — the ordinary single-reading case — compares equal either way and the program-name
// test silently keeps working. The comparison misfires only for a coexisting sibling whose lens name
// differs. The first draft of this header claimed it "failed for BOTH readings", and its own fixture
// disproved that: the broad reading was named "Plant" over hyperschema "Plant", so it rode the same
// branch with the fix present or reverted. Both lenses here are now named distinctly from the
// program, so both requests exercise the differing branch.
//
// WHAT THIS RAIL CAN AND CANNOT SEE. Warm and pinned resolution are semantically equal for the
// LATEST version by design — pinned resolution applies that version's own schema and its own
// resolvers — so a rail cannot discriminate `servesLive` by comparing response bodies on the latest
// version alone. What it CAN do, and now does, is make `pinned !== trueLatest` real: a second
// version of one lens, so v1 and v2 answer under their own schemas, and the older version is also
// addressed by its registration hash — which is what reaches the `@<hash>` branch (rest.ts:319) and
// its own lens-vs-program comparison, a path the first draft never entered.
//
// THE RESIDUAL GAP, named rather than implied: **`servesLive` (rest.ts:346) is NOT railed by this
// file and cannot be.** No assertion here observes WHICH of the two resolution paths ran, because
// warm and pinned resolution return the identical view for the latest version by design; closing it
// needs a materialization or resolver-invocation probe the gateway does not expose. This file rails
// the SURROUNDING lens-vs-program behavior — per-lens addressing, the `@<hash>` comparison, and the
// public admission filter — all of which do bite. An honest-looking header over a weaker test is how
// this defect class survives review, so the limit is stated rather than glossed.

// FROZEN AHEAD OF THE BUILD (ADLC P3), and deliberately NOT skipped. These rails land before the fix
// they accompany so that `rails-guard` has a real freeze baseline on main and any later edit to them
// is a visible, audited act. Unlike its sibling `test/gateway/byte-door-lens-gate.test.ts` — which
// fails against main and therefore lands `describe.skip` — everything asserted here ALREADY HOLDS on
// main: per-lens addressing, the `@<hash>` both-halves comparison, and the public admission filter
// are all correct today. Verified by running it against main: 5 passed.
//
// That is worth stating plainly rather than letting the file look stronger than it is. This file does
// NOT rail the one line the T42 build changes (`servesLive`, rest.ts:346) and cannot — see THE
// RESIDUAL GAP below. It is here as the standing regression guard for the surrounding behavior, and
// the build PR should not need to touch it at all.

import { describe, expect, it } from "vitest";
import { parseSchema, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { handleRest } from "../../src/surface/rest.js";
import { lensOf } from "../../src/gateway/registration.js";
import { PLANT } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

// A lens name is minted from the registration's `schema:<name>` pointer, and GENESIS derives that
// from the hyperschema — so a genesis lens can never differ from the program name. Both readings
// under test therefore arrive via `publishRegistration`, which does carry a distinct lens name.
// That is what lets neither of them ride the name coincidence that made the first draft insensitive.
const BASE: Schema = parseSchema({
  name: "Plant",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const LIVE: Schema = parseSchema({
  name: "PlantLive",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});
const ARCHIVAL: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "asc" } } } },
  default: { pick: { order: { byTimestamp: "asc" } } },
});
// A SECOND version of the archival lens — this is what makes `pinned !== trueLatest` reachable.
const ARCHIVAL_V2: Schema = parseSchema({
  name: "PlantClassic",
  alg: 1,
  props: { height: { pick: { order: { byTimestamp: "desc" } } } },
  default: { pick: { order: { byTimestamp: "desc" } } },
});

const boot = async (): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [{ hyperschema: PLANT, schema: BASE, roots: [FERN], writable: ["height"] }],
    }),
  );
  await gw.publishRegistration(PLANT, LIVE, [FERN], undefined, undefined, undefined, ["height"]);
  await gw.publishRegistration(PLANT, ARCHIVAL, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", 10, 1000, OP_SEED)]);
  await gw.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
  return gw;
};

const viewOf = (r: { body: unknown }): Record<string, number> =>
  (r.body as { view: Record<string, number> }).view;

const get = (gw: Gateway, door: "full" | "public", vTag: string, lens: string) =>
  handleRest(gw, door, "GET", [vTag, lens, FERN], undefined, OP_SEED);

describe("§21.7 — the REST door addresses each coexisting reading under its own policy", () => {
  it("PRECONDITION: neither lens name coincides with the program name", async () => {
    const gw = await boot();
    // Without this the fixture silently reverts to the insensitive shape the first draft had.
    const lenses = gw.registered.map((r) => ({ program: r.hyperschema.name, lens: lensOf(r) }));
    const plants = lenses.filter((l) => l.program === "Plant");
    expect(plants.length).toBeGreaterThanOrEqual(3);
    // The two readings under test are named distinctly from the program. The genesis lens shares the
    // program name unavoidably, and is present precisely so this fixture is not a special world.
    const underTest = plants
      .filter((l) => l.lens !== "Plant")
      .map((l) => l.lens)
      .sort();
    expect(underTest).toEqual(["PlantClassic", "PlantLive"]);
    await gw.close();
  });

  it("each lens answers under ITS OWN order — the readings are not conflated", async () => {
    const gw = await boot();
    const live = await get(gw, "full", "v1", "PlantLive");
    const archival = await get(gw, "full", "v1", "PlantClassic");
    expect(live.status).toBe(200);
    expect(archival.status).toBe(200);
    // One gather, two answers: `desc` takes the newest observation, `asc` the oldest. If the door
    // ever resolved both through one reading these would agree.
    expect(viewOf(live).height).toBe(99);
    expect(viewOf(archival).height).toBe(10);
    await gw.close();
  });

  it("a non-latest version is real: v1 and v2 of one lens answer under their own schemas", async () => {
    const gw = await boot();
    await gw.publishRegistration(PLANT, ARCHIVAL_V2, [FERN], undefined, undefined, undefined, [
      "height",
    ]);
    // v2 is now `trueLatest` for PlantClassic, so v1 is a genuinely pinned, non-latest read — the
    // state the warm/pinned split exists for, and one the first draft could not construct.
    const v1 = await get(gw, "full", "v1", "PlantClassic");
    const v2 = await get(gw, "full", "v2", "PlantClassic");
    expect(v1.status).toBe(200);
    expect(v2.status).toBe(200);
    expect(viewOf(v1).height).toBe(10); // asc — the original archival policy, still answerable
    expect(viewOf(v2).height).toBe(99); // desc — the evolved one
    await gw.close();
  });

  it("the @<hash> branch honours the lens: a sibling's registration hash is not addressable under this name", async () => {
    const gw = await boot();
    // rest.ts:319 compares BOTH halves — `v.deltaId === hash && lensOf(v) === schemaName`. This is
    // the one comparison in the versioned path that the v<N> alias branch never reaches.
    const versions = gw.registrationVersions();
    const classic = versions.find((v) => lensOf(v) === "PlantClassic");
    const live = versions.find((v) => lensOf(v) === "PlantLive");
    expect(classic).toBeDefined();
    expect(live).toBeDefined();

    // Its own hash under its own lens resolves, and answers under that lens's policy (asc → 10).
    const own = await get(gw, "full", `@${classic!.deltaId}`, "PlantClassic");
    expect(own.status).toBe(200);
    expect(viewOf(own).height).toBe(10);

    // The SIBLING's hash under this lens must not resolve — the hash exists and is lawful, so a
    // deltaId-only lookup would serve it. Both names must agree.
    const crossed = await get(gw, "full", `@${live!.deltaId}`, "PlantClassic");
    expect(crossed.status).toBe(404);
    await gw.close();
  });

  it("the public door serves ONLY the declared reading", async () => {
    const gw = await boot();
    await gw.declarePublic(["PlantClassic"]);
    const declared = await get(gw, "public", "v1", "PlantClassic");
    expect(declared.status).toBe(200);
    expect(viewOf(declared).height).toBe(10);
    // The undeclared sibling must not be addressable. Note precisely what this exercises: on the
    // public door `versionsFor`/`aliased` filter the version list by the admitted lens set, both
    // already keyed on `lensOf`, so this request 404s at the version lookup and control never
    // reaches `servesLive`. It is a regression test for the public admission filter, not evidence
    // about the line this file is named for — said plainly so the file is not misread as stronger.
    const undeclared = await get(gw, "public", "v1", "PlantLive");
    expect(undeclared.status).toBe(404);
    await gw.close();
  });
});
