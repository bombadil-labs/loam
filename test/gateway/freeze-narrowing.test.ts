import { describe, expect, it } from "vitest";
import { authorForSeed, type Delta, type Policy, type Schema } from "@bombadil/rhizomatic";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT } from "./fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import {
  assertClosureDoesNotLeak,
  assertPreservesSuppression,
  isPresent,
  isSuppressed,
  retraction,
} from "./narrowing.js";

const OP_SEED = "0e".repeat(32);
const OP = authorForSeed(OP_SEED);
const pick: Policy = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } };
const SCHEMA: Schema = {
  props: new Map<string, Policy>([
    ["height", pick],
    ["message", pick],
  ]),
  default: pick,
};

const boot = async (): Promise<Gateway> =>
  Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: SCHEMA, roots: [FERN], writable: ["height", "message"] },
      ],
    }),
  );

const loadVersion = async (members: readonly Delta[]): Promise<Gateway> => {
  const gw = await boot();
  await gw.append([...members]);
  return gw;
};

const byIds = (ids: readonly string[]): unknown => ({
  op: "select",
  pred: { match: { field: "id", cmp: "inSet", const: [...ids] } },
  in: "input",
});

describe("§27.2 freeze is a narrowing operation, and rides the shared H1 rail", () => {
  it("preserves suppression: a struck claim ships with its strike, and the DESTINATION reads it struck", async () => {
    const source = await boot();
    const older = observed(FERN, "height", 25, 900, OP_SEED);
    const struck = observed(FERN, "height", 30, 1000, OP_SEED);
    await source.append([older, struck]);
    await source.append([retraction(struck.id, OP, OP_SEED, 1100)]);

    const version = source.freeze(byIds([older.id, struck.id]));
    const destination = await loadVersion(version.members);

    assertPreservesSuppression({ what: "freeze", source, destination, struckClaim: struck.id });

    expect(source.resolvedNode("Plant", FERN).view.height).toBe(25);
    expect(destination.resolvedNode("Plant", FERN).view.height).toBe(25);

    await source.close();
    await destination.close();
  });

  it("does not leak: a retraction OUTSIDE the Term's scope stays out, and the admitted member survives", async () => {
    const source = await boot();
    const admitted = observed(FERN, "height", 30, 1000, OP_SEED);
    const excluded = observed(FERN, "message", "withdrawn", 950, OP_SEED);
    await source.append([admitted, excluded]);
    const strikeOfExcluded = retraction(excluded.id, OP, OP_SEED, 1100);
    await source.append([strikeOfExcluded]);

    expect(isSuppressed(source, excluded.id)).toBe(true);

    const version = source.freeze(byIds([admitted.id]));
    expect(version.members.map((d) => d.id)).toEqual([admitted.id]);

    const destination = await loadVersion(version.members);
    assertClosureDoesNotLeak({
      what: "freeze",
      destination,
      excludedTarget: excluded.id,
      itsRetraction: strikeOfExcluded.id,
    });

    expect(isPresent(destination, admitted.id)).toBe(true);
    expect(isSuppressed(destination, admitted.id)).toBe(false);
    expect(destination.resolvedNode("Plant", FERN).view.height).toBe(30);
    expect(destination.resolvedNode("Plant", FERN).view.message).toBeUndefined();

    await source.close();
    await destination.close();
  });

  it("is transitive: a strike of a strike crosses, so source and destination agree at any depth", async () => {
    const source = await boot();
    const claim = observed(FERN, "height", 30, 1000, OP_SEED);
    await source.append([claim]);
    const strike = retraction(claim.id, OP, OP_SEED, 1100);
    await source.append([strike]);
    const counterStrike = retraction(strike.id, OP, OP_SEED, 1200);
    await source.append([counterStrike]);

    const version = source.freeze(byIds([claim.id]));
    expect(version.members.map((d) => d.id).sort()).toEqual(
      [claim.id, strike.id, counterStrike.id].sort(),
    );

    const destination = await loadVersion(version.members);
    for (const id of [claim.id, strike.id, counterStrike.id]) {
      expect(isPresent(destination, id)).toBe(true);
      expect(isSuppressed(destination, id)).toBe(isSuppressed(source, id));
    }
    expect(destination.resolvedNode("Plant", FERN).view.height).toEqual(
      source.resolvedNode("Plant", FERN).view.height,
    );

    await source.close();
    await destination.close();
  });
});
