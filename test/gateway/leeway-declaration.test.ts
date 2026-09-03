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
// REVERT PROBES, MEASURED against this file as it stands — 11 cases. Re-measure when you add one;
// counts copied forward from an older revision read as measurement and are not.
//   the default is permissive instead of sealed          → 8 red,  3 green
//   a malformed leeway keeps the last one that parsed    → 5 red,  6 green
//   unknown keys are ignored rather than refused         → 1 red, 10 green
//   the depth bound is removed                           → 1 red, 10 green
//   a listing refresh drops the standing leeway          → 1 red, 10 green
// (counts predate the two-pointer case; the five probes above are unaffected by it)
// The last three isolate a single case each, which is what makes them worth keeping. Note that
// rails-red is weak here for the same reason as PR 1: `leeway` does not exist on the base tree, so
// nothing compiles there and no case runs.

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
import { SEALED_LEEWAY, type Leeway, type Terms } from "../../src/gateway/leeway.js";

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
  it("writes the leeway into the delta AND resolves it back", async () => {
    const gw = await open();
    const delta = declare("ada", WIDE, 1000);
    await gw.append([delta]);

    // Delta level: the pointer is there and carries the canonical JSON.
    expect(leewayPointerOf(delta)).toBe(JSON.stringify(WIDE));
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
      [JSON.stringify(WIDE), JSON.stringify(NARROW)].sort(),
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
          { role: "leeway", target: { kind: "primitive", value: JSON.stringify(NARROW) } },
          { role: "leeway", target: { kind: "primitive", value: JSON.stringify(WIDE) } },
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
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "ada")).not.toEqual(WIDE);
    });

    it("refuses an unknown key rather than reading it as a switch left off", async () => {
      const typo = JSON.stringify({ ...NARROW, recieve: true });
      const gw = await withSeeded(() => [malformed("ada", typo, 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/unknown key "recieve"/);
    });

    it('refuses "same" on a container\'s OWN leeway, where nothing encloses it', async () => {
      const value = JSON.stringify({ ...NARROW, delegate: "same" });
      const gw = await withSeeded(() => [malformed("ada", value, 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(defectsOf(gw).join("\n")).toMatch(/belongs inside delegation terms/);
    });

    it("refuses terms nested past the depth bound instead of walking them", async () => {
      let deep: Terms | "off" = "off";
      for (let i = 0; i < 40; i += 1) {
        deep = { receive: false, offer: false, publish: false, envelope: "small", delegate: deep };
      }
      const gw = await withSeeded(() => [
        malformed("ada", JSON.stringify({ ...NARROW, delegate: deep }), 1000),
      ]);
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
  const garden = async (): Promise<Gateway> => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
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
    expect(leewayOf(gw, name)).toEqual(SEALED_LEEWAY);
    await gw.close();
  });
});
