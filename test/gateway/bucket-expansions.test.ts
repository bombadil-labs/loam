// A resolver sees what its own gather gathered (SPEC §22.8, ticket T31). When a gather `expand`s a
// role, the child's whole hview is already sitting on the bucket entry — so the bucket entry's VALUE
// is the child's resolved view, not a bare entity id. That is what makes "given what I have, what can
// I make?" a read rather than a derived fact: a recipe expands its ingredients, and a resolver over
// that bucket can weigh each one's stock.
//
// The second rail is the load-bearing one. A recipe's ingredient bucket is the LINK deltas, and those
// do not change when the flour does. So the memo key must reach THROUGH the expansion into the child's
// ground — otherwise the answer goes stale exactly when it matters ("yes, make pasta" over flour that
// is gone), breaking §22.5's promise that the memo invalidates precisely when the ground does.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseSchema,
  parseTerm,
  signClaims,
  type Delta,
  type Primitive,
} from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "4c".repeat(32);
const OP = authorForSeed(SEED);
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const ALL = { all: { order: { byTimestamp: "asc" } } };
const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

// A resolver that can only work if it can SEE each ingredient's stock.
const MAKEABLE = {
  ingredient: {
    code:
      "export default (b) => b.every((e) => (e.value?.have ?? 0) > 0)" +
      " ? 'MAKEABLE' : 'MISSING: ' + b.filter((e) => !(e.value?.have > 0)).map((e) => e.value?.name).join(', ');",
    rung: "a" as const,
    type: "string" as const,
  },
};

const at = (timestamp: number) => ({ timestamp, author: OP });
const prop = (id: string, context: string, role: string, value: Primitive, ts: number): Delta =>
  signClaims(
    {
      ...at(ts),
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id, context } } },
        { role, target: { kind: "primitive", value } },
      ],
    },
    SEED,
  );
const ingredient = (recipe: string, item: string, ts: number): Delta =>
  signClaims(
    {
      ...at(ts),
      pointers: [
        {
          role: "recipe",
          target: { kind: "entity", entity: { id: recipe, context: "ingredient" } },
        },
        { role: "ingredient", target: { kind: "entity", entity: { id: item, context: "in" } } },
      ],
    },
    SEED,
  );

async function kitchen(withResolver = true): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
  await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
  await gw.publishRegistration(
    { name: "ItemH", alg: 1, body: parseTerm(GATHER) },
    parseSchema({ name: "Item", props: { have: PICK, name: PICK }, default: PICK }),
    [],
    undefined,
    undefined,
    undefined,
    ["have", "name"],
  );
  await gw.publishRegistration(
    {
      name: "RecipeH",
      alg: 1,
      body: parseTerm({
        op: "expand",
        role: { exact: "ingredient" },
        schema: "ItemH",
        reading: "Item",
        in: GATHER,
      }),
    },
    parseSchema({ name: "Recipe", props: { ingredient: ALL }, default: PICK }),
    [],
    undefined,
    undefined,
    undefined,
    [],
    withResolver ? MAKEABLE : undefined,
  );
  await gw.append([
    prop("item:flour", "name", "name", "flour", 10),
    prop("item:flour", "have", "have", 2, 11),
    prop("item:egg", "name", "name", "egg", 20),
    prop("item:egg", "have", "have", 0, 21),
    ingredient("recipe:pasta", "item:flour", 30),
    ingredient("recipe:pasta", "item:egg", 31),
  ]);
  return gw;
}

const pasta = async (gw: Gateway): Promise<unknown> => {
  const res = await gw.query(`{ recipe(entity: "recipe:pasta") { ingredient } }`);
  expect(res.errors).toBeUndefined();
  return (res.data as { recipe: { ingredient: unknown } }).recipe.ingredient;
};

describe("a resolver sees its own gather's expansions (T31)", () => {
  it("a bucket entry for an expanded pointer IS the child's resolved view, not its id", async () => {
    const gw = await kitchen();
    // Before T31 this resolver could only see ["item:flour","item:egg"] and could not weigh anything.
    expect(await pasta(gw)).toBe("MISSING: egg");
    await gw.close();
  });

  it("the memo reaches THROUGH the expansion: a change to the CHILD's ground recomputes", async () => {
    const gw = await kitchen();
    expect(await pasta(gw)).toBe("MISSING: egg");

    // Buy eggs. This touches the ITEM's ground — the recipe's own ingredient bucket (the link
    // deltas) is untouched, so a memo keyed only on that bucket would still say MISSING and the
    // pantry would lie about the pantry.
    await gw.append([prop("item:egg", "have", "have", 6, 40)]);
    expect(await pasta(gw)).toBe("MAKEABLE");

    // ...and back again when the eggs are used up: invalidation is not a one-way ratchet.
    await gw.append([prop("item:egg", "have", "have", 0, 50)]);
    expect(await pasta(gw)).toBe("MISSING: egg");
    await gw.close();
  });

  it("without a resolver the field is unchanged — expansion still resolves as the child view", async () => {
    const gw = await kitchen(false);
    const value = (await pasta(gw)) as Record<string, unknown>[];
    expect(Array.isArray(value)).toBe(true);
    expect(value.map((v) => v.name).sort()).toEqual(["egg", "flour"]);
    await gw.close();
  });

  it("a resolver sees exactly what the Policy sees — the gather's mask decides, not the resolver", async () => {
    // SPEC §22.9. A Policy SELECTS; a resolver only re-represents the survivors. `bucketOf` used to
    // drop negated entries on its own, which was the resolver layer performing a selection nobody
    // declared — and it diverged from `applyPolicy`, which is handed every entry. The gather's `mask`
    // is the declared knob: under `drop` a retracted delta never reaches the hview (so nothing
    // changes), and under `annotate` it arrives flagged and the RESOLVER decides.
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
    // NOTE the shape: the annotate mask feeds the group DIRECTLY, with no `select` between them.
    // rhizomatic drops the annotate tag channel through select/union (E14), so a select-in-the-middle
    // gather computes the negation flags and then discards them; `group` threads them into entries
    // (E7), and files by target context relative to the root, which is the scoping the select would
    // otherwise have provided.
    const ANNOTATED = {
      op: "group",
      key: "byTargetContext",
      in: { op: "mask", policy: "annotate", in: "input" },
    };
    await gw.publishRegistration(
      { name: "LedgerH", alg: 1, body: parseTerm(ANNOTATED) },
      parseSchema({ name: "Ledger", props: { note: ALL }, default: PICK }),
      ["ledger:1"],
      undefined,
      undefined,
      undefined,
      ["note"],
      {
        // Counts what it is given, and says how much of it was retracted — impossible to write at all
        // if the bucket had already made the choice.
        note: {
          code: "export default (b) => `${b.length} seen, ${b.filter((e) => e.negated).length} retracted`;",
          rung: "a" as const,
          type: "string" as const,
        },
      },
    );
    const note = (n: number, text: string) =>
      signClaims(
        {
          ...at(n),
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "ledger:1", context: "note" } },
            },
            { role: "note", target: { kind: "primitive", value: text } },
          ],
        },
        SEED,
      );
    const first = note(10, "one");
    await gw.append([first, note(11, "two")]);
    const read = async () =>
      (
        (await gw.query(`{ ledger(entity: "ledger:1") { note } }`)).data as {
          ledger: { note: string };
        }
      ).ledger.note;
    expect(await read()).toBe("2 seen, 0 retracted");

    // Retract one. Under an annotate mask it STAYS in the hview, flagged — and the resolver, which is
    // handed what the Policy is handed, can now see and report it.
    await gw.append([signClaims(makeNegationClaims(OP, 99, first.id), SEED)]);
    expect(await read()).toBe("2 seen, 1 retracted");
    await gw.close();
  });
});
