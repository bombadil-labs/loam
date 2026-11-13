import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { containerClaims, readContainerTable } from "../../src/gateway/container-law.js";
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
import { withStamp } from "../../src/gateway/stamp.js";
import { plant } from "../helpers/plant.js";

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

const leewayPointerOf = (d: Delta): string | undefined => {
  const p = d.claims.pointers.find((x) => x.role === "leeway");
  if (!p || p.target.kind !== "primitive") return undefined;
  return typeof p.target.value === "string" ? p.target.value : undefined;
};

const leewayOf = (gw: Gateway, name: string): Leeway | undefined =>
  readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(name)?.leeway;

const defectsOf = (gw: Gateway): readonly string[] =>
  readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).defects;

describe("§58 — a leeway is a declaration on the container", () => {
  it("SEALED is every switch off — the constant every other case in this file leans on", () => {
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

    expect(leewayPointerOf(delta)).toBe(canonicalLeewayJson(WIDE));
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
        validFrom: 1000,
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
    expect(leewayOf(gw, "ada")).toBeUndefined();
  });

  it("the door refuses a declaration carrying TWO leeway pointers", async () => {
    const gw = await open();
    const base = containerClaims(
      { container: "ada", trust: "curated", posture: "separate" },
      OP,
      1000,
    );
    const twice = signClaims(
      {
        timestamp: 1000,
        validFrom: 1000,
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
    const withSeeded = async (make: (op: string) => Delta[]): Promise<Gateway> => {
      const backend = new MemoryBackend();
      const gw = await open(backend);
      await plant(backend, make(gw.operatorAuthor!));
      return open(backend);
    };

    const malformed = (name: string, value: string, ts: number): Delta =>
      signClaims(
        {
          timestamp: ts,
          validFrom: ts,
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
      expect(leewayOf(gw, "bob")).toEqual(WIDE);
    });

    it("a malformed LATER declaration does not preserve the wider one", async () => {
      const gw = await withSeeded(() => [
        declare("ada", WIDE, 1000),
        malformed("ada", '{"receive":true}', 2000),
      ]);
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

    const withPointers = (name: string, values: unknown[], ts: number): Delta =>
      signClaims(
        {
          timestamp: ts,
          validFrom: ts,
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
      const twoFaced =
        '{"delegate":"off","envelope":"small","offer":false,"publish":false,"publish":true,"receive":false}';
      const gw = await withSeeded(() => [withPointers("ada", [twoFaced], 1000)]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "ada")?.publish).toBe(false);
      expect(defectsOf(gw).join("\n")).toMatch(/canonical form/);
    });

    it("an ambiguous declaration leaves nothing wide for a re-declaration to carry", async () => {
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

    const deepBytes = (levels: number): string =>
      '{"delegate":'.repeat(levels) +
      '"off"' +
      ',"envelope":"small","offer":false,"publish":false,"receive":false}'.repeat(levels);

    it("answers a defect, never a thrown stack, however deep the payload", () => {
      const deep = parseLeeway(deepBytes(20_000));
      expect("defect" in deep && deep.defect).toMatch(/nests deeper than 32 levels/);
      const brackets = parseLeeway("[".repeat(5000) + "]".repeat(5000));
      expect("defect" in brackets && brackets.defect).toMatch(/object carrying three switches/);
    });

    it("the door REFUSES a deep leeway by name, even from an author with no standing", async () => {
      const gw = await open();
      const stranger = "9c".repeat(32);
      const bad = signClaims(
        {
          timestamp: 1000,
          validFrom: 1000,
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
      const gw = await withSeeded(() => [
        malformed("ada", deepBytes(20_000), 1000),
        declare("bob", WIDE, 1000),
      ]);
      expect(leewayOf(gw, "ada")).toEqual(SEALED_LEEWAY);
      expect(leewayOf(gw, "bob")).toEqual(WIDE);
      expect(defectsOf(gw).join("\n")).toMatch(/container "ada"/);
    });

    it("pins the canonical spelling as literal bytes", () => {
      expect(canonicalLeewayJson(NARROW)).toBe(
        '{"delegate":"off","envelope":"small","offer":false,"publish":false,"receive":true}',
      );
    });

    it("refuses a key-REORDERED spelling of a wide leeway", async () => {
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

    const nested = (levels: number): string => {
      let deep: Terms | "off" = "off";
      for (let i = 0; i < levels; i += 1) {
        deep = { receive: false, offer: false, publish: false, envelope: "small", delegate: deep };
      }
      return canonicalLeewayJson({ ...NARROW, delegate: deep });
    };

    it("admits terms exactly at the depth bound and refuses one level past it", async () => {
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
    await gw.list("Plant", { limit: 1 });
    expect(leewayOf(gw, name)).toEqual(SEALED_LEEWAY);

    const standing = readContainerTable(
      gw.reactor,
      gw.validityNow(),
      gw.operatorAuthor,
    ).containers.get(name)!;
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            {
              container: name,
              trust: standing.trust,
              posture: standing.posture,
              membership: standing.membership,
              leeway: WIDE,
            },
            OP,
            t,
          ),
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

    expect(leewayOf(gw, name)).toEqual(WIDE);
    await gw.close();
  });

  it("does not launder an ambiguous leeway into a legal one", async () => {
    const backend = new MemoryBackend();
    const gw = await garden(backend);
    await gw.append([observed(FERN, "height", 30, 1000, GARDENER_SEED)]);
    const name = listingContainerName("Plant");
    await gw.list("Plant", { limit: 1 });
    const standing = readContainerTable(
      gw.reactor,
      gw.validityNow(),
      gw.operatorAuthor,
    ).containers.get(name)!;
    const base = withStamp(gw.stamp(OP), (t) =>
      containerClaims(
        {
          container: name,
          trust: standing.trust,
          posture: standing.posture,
          membership: standing.membership,
        },
        OP,
        t,
      ),
    );
    await plant(backend, [
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
    const said = readContainerTable(gw.reactor, gw.validityNow(), gw.operatorAuthor).containers.get(
      name,
    )!;
    expect(said.leeway).toMatchObject({ receive: false, publish: false, delegate: "off" });
    await gw.append([
      signClaims(
        withStamp(gw.stamp(OP), (t) =>
          containerClaims(
            {
              container: name,
              trust: said.trust,
              posture: said.posture,
              membership: said.membership,
              leeway: WIDE,
            },
            OP,
            t,
          ),
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
