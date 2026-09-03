// T263 — a leeway is a DECLARATION on the container (SPEC §58, position 4: "A leeway is a
// declaration on the container, so changing it later ... is a delta the next request obeys").
//
// Railed at BOTH LEVELS throughout, because either alone has missed a bug in this repo before:
// what the DELTA carries (the `leeway` pointer and its canonical JSON) AND what a READER resolves
// through `readContainerTable`. A store that carried the right pointer and resolved the wrong
// leeway would pass a delta-only rail; one that resolved correctly from a pointer it never wrote
// would pass an object-only rail.
//
// THE DIRECTION THAT MATTERS IS CLOSED. An absent leeway and a malformed one must both read
// SEALED — every switch off. A defect that fell back to the PREVIOUS declaration would let a
// malformed later delta pin an older, wider grant in place, which is a report of permission
// nobody granted (H9). That case is `a malformed later declaration does not preserve the wider
// one` below, and it is the sharpest test in this file.
//
// Deliberately NOT here: the fit rule (`test/gateway/leeway-fit.test.ts`, a frozen rail of this
// ticket's PR 1), and any ACT a switch gates — receive, offer and publish each land with their own
// slice. This file proves only that a leeway can be written, read back, superseded, and refused.
//
// The malformed cases seed the backend DIRECTLY and re-open, which models a delta arriving by a
// path other than this store's own door — federation is the real one. The door's own refusal is
// railed separately, in `the door refuses a malformed leeway`.
//
// REVERT PROBES AND RAILS-RED, both MEASURED against this file as it stands — 24 cases. Re-measure
// when you add one; counts copied forward from an older revision read as measurement and are not,
// and earlier revisions of this block got that wrong twice.
//
// RAILS-RED, run on origin/main with this file copied in: 24 red, 0 green.
//
// REVERT PROBES:
//   the sealed default is permissive instead                → 16 red,  8 green
//   the reader takes the first of two leeway pointers       →  3 red, 21 green
//   the canonical-form check is removed                     →  2 red, 22 green
//   the canonical form is not sorted                        →  2 red, 22 green
//   the canonical walk runs BEFORE the depth bound          →  3 red, 21 green
//   unknown keys are ignored rather than refused            →  1 red, 23 green
//   the depth bound is removed                              →  5 red, 19 green
//   a listing refresh drops the standing leeway             →  1 red, 23 green
// The narrow ones isolate one to three cases each, which is what makes them worth keeping. The
// fifth is this file's own history: canonicalising an unvalidated value walked whatever depth an
// author sent, and a parser promising a defect sentence threw a RangeError instead.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { listingContainerName } from "../../src/gateway/listing.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE, pickLatest } from "./fixtures.js";
import {
  canonicalLeewayJson,
  parseLeeway,
  SEALED_LEEWAY,
  type Leeway,
  type Terms,
} from "../../src/gateway/leeway.js";

const OP_SEED = "b7".repeat(32);
const OP = authorForSeed(OP_SEED);

const WIDE: Leeway = {
  receive: true,
  offer: true,
  publish: true,
  envelope: "large",
  delegate: { receive: true, offer: false, publish: false, envelope: "medium", delegate: "same" },
};
const NARROW: Leeway = {
  receive: true,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};

const open = async (backend = new MemoryBackend()): Promise<Gateway> =>
  Gateway.open(backend, { seed: OP_SEED });

const declare = (name: string, leeway: Leeway | undefined, ts: number): Delta =>
  signClaims(
    containerClaims(
      { container: name, trust: "curated", posture: "separate", ...(leeway ? { leeway } : {}) },
      OP,
      ts,
    ),
    OP_SEED,
  );

/** The `leeway` primitive a declaration delta carries, or undefined — the DELTA level. */
const leewayPointerOf = (d: Delta): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === "leeway");
  if (!p || p.target.kind !== "primitive") return undefined;
  return typeof p.target.value === "string" ? p.target.value : undefined;
};

/** What a reader resolves for a container — the OBJECT level. */
const leewayOf = (gw: Gateway, name: string): Leeway | undefined =>
  readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name)?.leeway;

const defectsOf = (gw: Gateway): readonly string[] =>
  readContainerTable(gw.reactor, gw.operatorAuthor).defects;

describe("§58 — a leeway is a declaration on the container", () => {
  it("SEALED is every switch off — the constant every other case in this file leans on", () => {
    // Without this, `toEqual(SEALED_LEEWAY)` is a tautology: a constant with every switch ON would
    // satisfy every "reads sealed" assertion here, and the file would prove the opposite of what
    // it claims while staying green.
    expect(SEALED_LEEWAY).toEqual({
      receive: false,
      offer: false,
      publish: false,
      envelope: "small",
      delegate: "off",
    });
  });

  it("writes the leeway into the delta AND resolves it back", async () => {
    const gw = await open();
    const delta = declare("ada", WIDE, 1000);
    await gw.append([delta]);

    // Delta level: the pointer is there and carries the canonical JSON.
    expect(leewayPointerOf(delta)).toBe(canonicalLeewayJson(WIDE));
    // Object level: a reader resolves the same value, nesting and all.
    expect(leewayOf(gw, "ada")).toEqual(WIDE);
  });

  it("reads SEALED when a declaration carries no leeway, and writes no pointer", async () => {
    const gw = await open();
    const delta = declare("ada", undefined, 1000);
    await gw.append([delta]);

    expect(leewayPointerOf(delta)).toBeUndefined();
    expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
    expect(leewayOf(gw, "ada")?.delegate).toBe("off");
  });

  it("takes the LATEST declaration — a leeway change is a delta, not a restart", async () => {
    const gw = await open();
    await gw.append([declare("ada", WIDE, 1000)]);
    expect(leewayOf(gw, "ada")).toEqual(WIDE);

    await gw.append([declare("ada", NARROW, 2000)]);
    expect(leewayOf(gw, "ada")).toEqual(NARROW);

    // Two-sided: the earlier declaration was superseded, never rewritten. Both still stand.
    const both = [...gw.reactor.snapshot()].filter((d) => leewayPointerOf(d) !== undefined);
    expect(both.map(leewayPointerOf).sort()).toEqual(
      [canonicalLeewayJson(WIDE), canonicalLeewayJson(NARROW)].sort(),
    );
  });

  it("the door refuses a malformed leeway", async () => {
    const gw = await open();
    const bad = signClaims(
      {
        timestamp: 1000,
        author: OP,
        pointers: [
          ...containerClaims({ container: "ada", trust: "curated", posture: "separate" }, OP, 1000)
            .pointers,
          { role: "leeway", target: { kind: "primitive", value: '{"receive":"yes"}' } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([bad])).rejects.toThrow(/leeway is malformed/);
    // Two-sided: nothing landed, so nothing named "ada" stands at all.
    expect(leewayOf(gw, "ada")).toBeUndefined();
  });

  it("the door refuses a declaration carrying TWO leeway pointers", async () => {
    // Two pointers is ambiguous law, not a merge: the reader takes the first and the second is
    // silently law nobody can see. Refusing is the only answer that cannot mislead.
    const gw = await open();
    const base = containerClaims(
      { container: "ada", trust: "curated", posture: "separate" },
      OP,
      1000,
    );
    const twice = signClaims(
      {
        timestamp: 1000,
        author: OP,
        pointers: [
          ...base.pointers,
          { role: "leeway", target: { kind: "primitive", value: canonicalLeewayJson(NARROW) } },
          { role: "leeway", target: { kind: "primitive", value: canonicalLeewayJson(WIDE) } },
        ],
      },
      OP_SEED,
    );
    await expect(gw.append([twice])).rejects.toThrow(/at most one leeway pointer/);
    expect(leewayOf(gw, "ada")).toBeUndefined();
  });

  describe("a leeway that arrives malformed by another path is NOT BINDING", () => {
    /** Seed a backend with a genesis gateway's ground plus hand-built deltas, then re-open. */
    const withSeeded = async (make: (op: string) => Delta[]): Promise<Gateway> => {
      const backend = new MemoryBackend();
      const gw = await open(backend);
      await backend.append(make(gw.operatorAuthor!));
      return open(backend);
    };

    const malformed = (name: string, value: string, ts: number): Delta =>
      signClaims(
        {
          timestamp: ts,
          author: OP,
          pointers: [
            ...containerClaims({ container: name, trust: "curated", posture: "separate" }, OP, ts)
              .pointers,
            { role: "leeway", target: { kind: "primitive", value } },
          ],
        },
        OP_SEED,
      );

    it("reads SEALED and names a defect, while a good sibling is untouched", async () => {
      const gw = await withSeeded(() => [
        malformed("ada", "{not json", 1000),
        declare("bob", WIDE, 1000),
      ]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/container "ada".*not binding.*reads as sealed/s);
      // The bystander: one container's broken declaration must not narrow another's.
      expect(leewayOf(gw, "bob")).toEqual(WIDE);
    });

    it("a malformed LATER declaration does not preserve the wider one", async () => {
      // THE SHARP CASE. Falling back to the previous declaration would let a broken delta pin an
      // older, wider grant in place — permission nobody granted, arriving through a defect.
      const gw = await withSeeded(() => [
        declare("ada", WIDE, 1000),
        malformed("ada", '{"receive":true}', 2000),
      ]);
      // Asserted on the FIELDS, not only against the constant. `toEqual(SEALED_LEEWAY)` alone is
      // satisfied by undefined-equals-undefined wherever the constant is missing, which is how
      // this case — the sharpest in the file — passed on the base tree while proving nothing.
      const read = leewayOf(gw, "ada");
      expect(read).toBeDefined();
      expect(read).toMatchObject({
        receive: false,
        offer: false,
        publish: false,
        envelope: "small",
        delegate: "off",
      });
      expect(read).toEqual(SEALED_LEEWAY);
    });

    /** A declaration carrying arbitrary `leeway` pointers — including none, several, or non-strings. */
    const withPointers = (name: string, values: unknown[], ts: number): Delta =>
      signClaims(
        {
          timestamp: ts,
          author: OP,
          pointers: [
            ...containerClaims({ container: name, trust: "curated", posture: "separate" }, OP, ts)
              .pointers,
            ...values.map((value) => ({
              role: "leeway",
              target: { kind: "primitive" as const, value: value as string },
            })),
          ],
        },
        OP_SEED,
      );

    it("refuses TWO leeway pointers at the READER, not only at the door", async () => {
      // The door calls two pointers ambiguous. A reader that took the first would bind a grant the
      // door refused to read — wide, silently, and whichever one the author chose to put first.
      // Both orders, because "takes the first" and "takes the last" are different bugs.
      for (const order of [
        [canonicalLeewayJson(WIDE), canonicalLeewayJson(NARROW)],
        [canonicalLeewayJson(NARROW), canonicalLeewayJson(WIDE)],
      ]) {
        const gw = await withSeeded(() => [withPointers("ada", order, 1000)]);
        expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
        expect(leewayOf(gw, "ada")).not.toEqual(WIDE);
        expect(defectsOf(gw).join("\n")).toMatch(/more than one leeway pointer/);
      }
    });

    it("refuses a leeway pointer that is not a string, and says so", async () => {
      const gw = await withSeeded(() => [withPointers("ada", [42], 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/one JSON string primitive/);
    });

    it("refuses a leeway whose bytes do not say what they mean", async () => {
      // `JSON.parse` resolves a duplicate key to the LAST one, so these bytes plainly read
      // publish:false and would have resolved publish:true — law that misreports itself at rest.
      const twoFaced =
        '{"delegate":"off","envelope":"small","offer":false,"publish":false,"publish":true,"receive":false}';
      const gw = await withSeeded(() => [withPointers("ada", [twoFaced], 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "ada")?.publish).toBe(false);
      expect(defectsOf(gw).join("\n")).toMatch(/canonical form/);
    });

    it("an ambiguous declaration leaves nothing wide for a re-declaration to carry", async () => {
      // A re-declaration carries the STANDING leeway forward. If the reader had bound the wide
      // pointer, any refresh would mint a fresh SINGLE-pointer declaration carrying it — turning
      // law the door refuses into law it accepts, permanently, on an ordinary read. The end-to-end
      // form of that is railed in the listing block below; this is its precondition.
      const gw = await withSeeded(() => [
        withPointers("ada", [canonicalLeewayJson(WIDE), canonicalLeewayJson(NARROW)], 1000),
      ]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      const legalLooking = [...gw.reactor.snapshot()].filter(
        (d) =>
          d.claims.pointers.filter((x) => x.role === "leeway").length === 1 &&
          leewayPointerOf(d) === canonicalLeewayJson(WIDE),
      );
      expect(legalLooking).toEqual([]);
    });

    /** A CANONICAL terms chain `levels` deep, built as raw bytes so the fixture is not the thing
     *  under test. Sorted keys: delegate, envelope, offer, publish, receive. */
    const deepBytes = (levels: number): string =>
      '{"delegate":'.repeat(levels) +
      '"off"' +
      ',"envelope":"small","offer":false,"publish":false,"receive":false}'.repeat(levels);

    it("answers a defect, never a thrown stack, however deep the payload", () => {
      // The canonical walk recurses, so running it BEFORE the depth bound walked whatever an
      // author sent: a few kilobytes of nesting overflowed the stack and turned this parser's
      // promised defect sentence into a RangeError. 20000 levels is far past where that began.
      const deep = parseLeeway(deepBytes(20_000));
      expect("defect" in deep && deep.defect).toMatch(/nests deeper than 32 levels/);
      // And the cheap shape: ten thousand bytes of brackets, which `JSON.stringify` recursed into
      // even though `sortKeys` left arrays alone.
      const brackets = parseLeeway("[".repeat(5000) + "]".repeat(5000));
      expect("defect" in brackets && brackets.defect).toMatch(/object carrying three switches/);
    });

    it("the door REFUSES a deep leeway by name, even from an author with no standing", async () => {
      // `containerDefect` runs before the standing check, so a shape defect is refused for
      // everyone — which also means anyone could reach the overflow. The refusal must be a
      // sentence, not a stack.
      const gw = await open();
      const stranger = "9c".repeat(32);
      const bad = signClaims(
        {
          timestamp: 1000,
          author: authorForSeed(stranger),
          pointers: [
            ...containerClaims(
              { container: "ada", trust: "curated", posture: "separate" },
              authorForSeed(stranger),
              1000,
            ).pointers,
            { role: "leeway", target: { kind: "primitive", value: deepBytes(20_000) } },
          ],
        },
        stranger,
      );
      await expect(gw.append([bad])).rejects.toThrow(/leeway is malformed/);
    });

    it("a deep leeway at rest leaves every OTHER container readable", async () => {
      // The reader resolves the whole table in one pass, so a parser that throws here does not
      // narrow one container — it deletes all of them. The named bystander is the whole point.
      const gw = await withSeeded(() => [
        malformed("ada", deepBytes(20_000), 1000),
        declare("bob", WIDE, 1000),
      ]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "bob")).toEqual(WIDE);
      expect(defectsOf(gw).join("\n")).toMatch(/container "ada"/);
    });

    it("pins the canonical spelling as literal bytes", () => {
      // Every other canonical assertion compares `canonicalLeewayJson` against itself, so the
      // at-rest form of every stored leeway could change without a red bar. This is the one case
      // that would notice.
      expect(canonicalLeewayJson(NARROW)).toBe(
        '{"delegate":"off","envelope":"small","offer":false,"publish":false,"receive":true}',
      );
    });

    it("refuses a key-REORDERED spelling of a wide leeway", async () => {
      // The sorting half of the canonical rule. Without it this spelling binds WIDE; with it the
      // container reads sealed. Delete `.sort()` and this is the case that goes red.
      const unsorted =
        '{"receive":true,"offer":true,"publish":true,"envelope":"large","delegate":"off"}';
      const gw = await withSeeded(() => [malformed("ada", unsorted, 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "ada")?.publish).toBe(false);
      expect(defectsOf(gw).join("\n")).toMatch(/canonical form/);
    });

    it("refuses an unknown key rather than reading it as a switch left off", async () => {
      const typo = canonicalLeewayJson({ ...NARROW, recieve: true });
      const gw = await withSeeded(() => [malformed("ada", typo, 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/unknown key "recieve"/);
    });

    it('refuses "same" on a container\'s OWN leeway, where nothing encloses it', async () => {
      const value = canonicalLeewayJson({ ...NARROW, delegate: "same" });
      const gw = await withSeeded(() => [malformed("ada", value, 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/belongs inside delegation terms/);
    });

    /** A leeway whose delegate is `levels` nested terms deep. */
    const nested = (levels: number): string => {
      let deep: Terms | "off" = "off";
      for (let i = 0; i < levels; i += 1) {
        deep = { receive: false, offer: false, publish: false, envelope: "small", delegate: deep };
      }
      return canonicalLeewayJson({ ...NARROW, delegate: deep });
    };

    it("admits terms exactly at the depth bound and refuses one level past it", async () => {
      // The bound is EXACT and pinned here on purpose. A test that only tried something far past
      // it would pass with the constant quietly widened, which is a bound that stops bounding.
      const deepest = await withSeeded(() => [malformed("ada", nested(32), 1000)]);
      expect(leewayOf(deepest, "ada")).not.toEqual(SEALED_LEEWAY);
      expect(defectsOf(deepest)).toEqual([]);

      const past = await withSeeded(() => [malformed("ada", nested(33), 1000)]);
      expect(leewayOf(past, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(past).join("\n")).toMatch(/nests deeper than 32 levels/);
    });

    it("refuses a chain well past the bound, through the reader", async () => {
      const gw = await withSeeded(() => [malformed("ada", nested(200), 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/nests deeper than/);
    });
  });
});

// A LISTING READ RE-DECLARES THE CONTAINER IT BACKS, and a re-declaration is latest-wins per
// DECLARATION: a knob it omits is a knob it deletes. `parent` and `version` are carried for that
// reason already; a leeway had to join them, or a read would silently un-configure what a person
// wrote. This block is here rather than beside the listing's own rails because that file is T110's
// and frozen.
describe("§58 — a listing refresh carries a standing leeway forward", () => {
  const garden = async (backend = new MemoryBackend()): Promise<Gateway> => {
    const gw = await Gateway.open(backend, { seed: OP_SEED });
    await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 1), OP_SEED)]);
    gw.register(PLANT, PLANT_POLICY, [FERN], undefined, PLANT_WRITABLE);
    return gw;
  };

  it("keeps a leeway the refresh knew nothing about, and writes none where none stands", async () => {
    const gw = await garden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    await gw.list("Plant", { limit: 1 }); // the first read declares the backing container
    expect(leewayOf(gw, name)).toEqual(SEALED_LEEWAY); // it declared none, so: sealed

    // The person configures it. Then a sibling lens widens the context union, so the next read
    // MUST re-declare — the moment a carried-forward knob is dropped, if it is dropped.
    const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name)!;
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: name,
            trust: standing.trust,
            posture: standing.posture,
            membership: standing.membership,
            leeway: WIDE,
          },
          OP,
          gw.nextTimestamp(),
        ),
        OP_SEED,
      ),
    ]);
    expect(leewayOf(gw, name)).toEqual(WIDE);

    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Sketch");

    // A read must not undo a write.
    expect(leewayOf(gw, name)).toEqual(WIDE);
    await gw.close();
  });

  it("does not launder an ambiguous leeway into a legal one", async () => {
    // END TO END. Seed a listing container with two leeway pointers — law the door refuses — then
    // force a refresh. The refresh carries the STANDING leeway, so if the reader had bound the
    // wide pointer this read would mint a fresh, door-legal declaration carrying it.
    const backend = new MemoryBackend();
    const gw = await garden(backend);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    await gw.list("Plant", { limit: 1 });
    const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name)!;
    const base = containerClaims(
      {
        container: name,
        trust: standing.trust,
        posture: standing.posture,
        membership: standing.membership,
      },
      OP,
      gw.nextTimestamp(),
    );
    // Seeded while `gw` still holds the backend, then read by a SECOND gateway: closing this one
    // would close the store under it. `gw` is not used again after this point.
    await backend.append([
      signClaims(
        {
          ...base,
          pointers: [
            ...base.pointers,
            { role: "leeway", target: { kind: "primitive", value: canonicalLeewayJson(WIDE) } },
            { role: "leeway", target: { kind: "primitive", value: canonicalLeewayJson(NARROW) } },
          ],
        },
        OP_SEED,
      ),
    ]);

    const reopened = await garden(backend);
    expect(leewayOf(reopened, name)).toEqual(SEALED_LEEWAY);
    await reopened.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await reopened.list("Sketch");

    // Nothing door-legal and wide was minted, and the reading did not move.
    const laundered = [...reopened.reactor.snapshot()].filter(
      (d) =>
        d.claims.pointers.filter((x) => x.role === "leeway").length === 1 &&
        leewayPointerOf(d) === canonicalLeewayJson(WIDE),
    );
    expect(laundered).toEqual([]);
    expect(leewayOf(reopened, name)).toEqual(SEALED_LEEWAY);
    await reopened.close();
  });

  it("writes NO leeway pointer when the standing one is sealed, so the bytes do not move", async () => {
    // The other side of the carry: a leeway is never undefined on a resolved container, so an
    // unconditional carry would stamp an explicit sealed pointer onto every listing container in
    // the world. Sealed and absent resolve identically, so the sealed case stays unwritten.
    const gw = await garden();
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    await gw.list("Plant", { limit: 1 });
    await gw.publishRegistration(
      PLANT,
      { name: "Sketch", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Sketch");

    const declarations = [...gw.reactor.snapshot()].filter(
      (d) =>
        d.claims.pointers.some(
          (x) =>
            x.role === "container" && x.target.kind === "entity" && x.target.entity.id === name,
        ) && leewayPointerOf(d) !== undefined,
    );
    expect(declarations).toEqual([]);
    // Two-sided, or the empty list above proves only that leeway is unimplemented: the same
    // refresh DOES write a pointer once the container has something to say.
    const said = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(name)!;
    expect(said.leeway).toMatchObject({ receive: false, publish: false, delegate: "off" });
    await gw.append([
      signClaims(
        containerClaims(
          {
            container: name,
            trust: said.trust,
            posture: said.posture,
            membership: said.membership,
            leeway: WIDE,
          },
          OP,
          gw.nextTimestamp(),
        ),
        OP_SEED,
      ),
    ]);
    await gw.publishRegistration(
      PLANT,
      { name: "Doodle", props: new Map([["note", pickLatest]]), default: pickLatest },
      [FERN],
    );
    await gw.list("Doodle");
    expect(leewayOf(gw, name)).toEqual(WIDE);
    await gw.close();
  });
});
