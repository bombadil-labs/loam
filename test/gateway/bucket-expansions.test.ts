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

const MAKEABLE = {
  ingredient: {
    code:
      "export default (b) => b.every((e) => (e.value?.have ?? 0) > 0)" +
      " ? 'MAKEABLE' : 'MISSING: ' + b.filter((e) => !(e.value?.have > 0)).map((e) => e.value?.name).join(', ');",
    rung: "a" as const,
    type: "string" as const,
  },
};

const at = (timestamp: number) => ({ timestamp, validFrom: timestamp, author: OP });
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
    expect(await pasta(gw)).toBe("MISSING: egg");
    await gw.close();
  });

  it("the memo reaches THROUGH the expansion: a change to the CHILD's ground recomputes", async () => {
    const gw = await kitchen();
    expect(await pasta(gw)).toBe("MISSING: egg");

    await gw.append([prop("item:egg", "have", "have", 6, 40)]);
    expect(await pasta(gw)).toBe("MAKEABLE");

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
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
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

    await gw.append([signClaims(makeNegationClaims(OP, 99, first.id), SEED)]);
    expect(await read()).toBe("2 seen, 1 retracted");
    await gw.close();
  });

  it("a parent recomputes when its CHILD's ground changes, under an annotate child gather too", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
    const ANNOTATED = {
      op: "group",
      key: "byTargetContext",
      in: { op: "mask", policy: "annotate", in: "input" },
    };
    await gw.publishRegistration(
      { name: "NoteH", alg: 1, body: parseTerm(ANNOTATED) },
      parseSchema({ name: "Note", props: { body: ALL }, default: PICK }),
      [],
      undefined,
      undefined,
      undefined,
      ["body"],
    );
    await gw.publishRegistration(
      {
        name: "PageH",
        alg: 1,
        body: parseTerm({
          op: "expand",
          role: { exact: "note" },
          schema: "NoteH",
          reading: "Note",
          in: GATHER,
        }),
      },
      parseSchema({ name: "Page", props: { note: ALL }, default: PICK }),
      ["page:1"],
      undefined,
      undefined,
      undefined,
      [],
      {
        note: {
          code:
            "export default (b) => String(b.reduce((n, e) => n + " +
            "((e.value && Array.isArray(e.value.body)) ? e.value.body.length : 0), 0));",
          rung: "a" as const,
          type: "string" as const,
        },
      },
    );
    const body = (n: number, text: string) =>
      signClaims(
        {
          ...at(n),
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "note:a", context: "body" } },
            },
            { role: "body", target: { kind: "primitive", value: text } },
          ],
        },
        SEED,
      );
    const first = body(10, "one");
    await gw.append([
      first,
      body(11, "two"),
      signClaims(
        {
          ...at(12),
          pointers: [
            { role: "page", target: { kind: "entity", entity: { id: "page:1", context: "note" } } },
            { role: "note", target: { kind: "entity", entity: { id: "note:a", context: "in" } } },
          ],
        },
        SEED,
      ),
    ]);
    const count = async () =>
      ((await gw.query(`{ page(entity: "page:1") { note } }`)).data as { page: { note: string } })
        .page.note;
    expect(await count()).toBe("2");

    await gw.append([signClaims(makeNegationClaims(OP, 99, first.id), SEED)]);
    expect(await count()).toBe("2");

    await gw.append([body(13, "three")]);
    expect(await count()).toBe("3");
    await gw.close();
  });
});
