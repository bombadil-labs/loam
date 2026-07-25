// Immutable-by-default, said out loud (T81). §21's posture is right and stays: a registration that
// names no `writable` field accepts no surface write. What was missing is the THREAD — a newcomer
// who writes an unopened prop met GraphQL's generic "Unknown argument", which names the field and
// never names the knob that would open it. So this rail asserts the refusal is still a refusal AND
// that the word `writable` is reachable from the surface: in the mutation field's own description
// (the arg does not exist, so only the schema can say why), and in the assert/clear/remove refusal
// (the arg does exist there — the field name is the argument).
//
// The second half is a DOCS-TRUTH rail: the README ships a complete registration file, and this
// registers that exact JSON and runs the README's own example mutation against it. It is extracted
// from README.md rather than copied here, so the manual cannot drift out from under the test.
// Delta-level erasure/suppression is out of scope — writability is front-door discipline only, and
// mutate.ts's own comment says so; the ground-level rail lives in test/gateway/mutate.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "d4".repeat(32);

// The operator roots the capability chain, so its writes meet no gate but writability.
async function operatorGateway(writable?: readonly string[]): Promise<Gateway> {
  const g = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
  g.register(PLANT, PLANT_POLICY, [FERN], undefined, writable);
  return g;
}

async function mutationDescription(g: Gateway, field: string): Promise<string> {
  const res = await g.query(`{ __schema { mutationType { fields { name description } } } }`);
  expect(res.errors).toBeUndefined();
  const fields = (
    res.data as { __schema: { mutationType: { fields: { name: string; description: string }[] } } }
  ).__schema.mutationType.fields;
  const found = fields.find((f) => f.name === field);
  expect(found, `the surface offers a ${field} mutation`).toBeDefined();
  return found!.description;
}

describe("the writable thread", () => {
  it("a registration with no writable refuses the prop mutation, and the field says why", async () => {
    const g = await operatorGateway(); // silence: nothing writable
    const res = await g.query(`mutation { plant(entity: "${FERN}", height: 4) { height } }`);
    expect(res.errors?.join(" "), "the write is refused").toMatch(/height/i);
    // The refusal is GraphQL's own schema validation, so the only place left to explain is the
    // field's description — which must name the knob, not just the consequence.
    expect(await mutationDescription(g, "plant")).toContain("writable");
    await g.close();
  });

  it("names the props left read-only, so a reader sees WHICH fields are shut", async () => {
    const g = await operatorGateway(["height"]); // one open, the rest shut
    const description = await mutationDescription(g, "plant");
    expect(description).toContain("writable");
    for (const shut of ["tag", "watered", "readings"]) {
      expect(description, `${shut} is read-only and the field says so`).toContain(shut);
    }
    await g.close();
  });

  it("the clear refusal names `writable` too — a field name IS the argument there", async () => {
    const g = await operatorGateway(["height"]);
    const res = await g.query(
      `mutation { clearPlant(entity: "${FERN}", fields: ["tag"]) { tag } }`,
    );
    const message = res.errors?.join(" ") ?? "";
    expect(message, "still read-only").toContain("read-only");
    expect(message, "and the reason names the knob").toContain("writable");
    await g.close();
  });
});

// The README's shipped register file, extracted rather than copied: one fenced ```json block
// carrying a `hyperschema`. If the README grows a second, this fails rather than guessing.
function readmeRegistration(): unknown {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const blocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => m[1]!)
    .filter((b) => b.includes(`"hyperschema"`));
  expect(blocks, "README ships exactly one registration example").toHaveLength(1);
  return JSON.parse(blocks[0]!);
}

describe("the README's own hello-world", () => {
  it("registers verbatim and accepts the mutation the README prints", async () => {
    const input = parseRegistrationInput(readmeRegistration());
    const g = await Gateway.open(new MemoryBackend(), { seed: OP_SEED });
    g.register(input.hyperschema, input.schema, input.roots, input.mutations, input.writable);
    // README, "Capabilities: authors, not owners" — the sugar mutation, verbatim.
    const res = await g.query(`mutation { plant(entity: "plant:fern", height: 40) { height } }`);
    expect(res.errors, "the README's example runs as printed").toBeUndefined();
    expect((res.data as { plant: { height: number } }).plant.height).toBe(40);
    await g.close();
  });

  it("states the true rule: silence about writable means read-only", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    // The exact inversion this ticket came from: the README promised the permissive default.
    expect(readme).not.toMatch(/omit it to leave every field writable/i);
    expect(readme).toMatch(/writable/);
    expect(readme, "the manual states the deny-by-default posture").toMatch(
      /omit[^.]{0,80}read-only/i,
    );
  });
});
