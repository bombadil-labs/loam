import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { PLANT, PLANT_POLICY } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OP_SEED = "d4".repeat(32);

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
    const g = await operatorGateway();
    const res = await g.query(`mutation { plant(entity: "${FERN}", height: 4) { height } }`);
    expect(res.errors?.join(" "), "the write is refused").toMatch(/height/i);
    expect(await mutationDescription(g, "plant")).toContain("writable");
    await g.close();
  });

  it("names the props left read-only, so a reader sees WHICH fields are shut", async () => {
    const g = await operatorGateway(["height"]);
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
    const res = await g.query(`mutation { plant(entity: "plant:fern", height: 40) { height } }`);
    expect(res.errors, "the README's example runs as printed").toBeUndefined();
    expect((res.data as { plant: { height: number } }).plant.height).toBe(40);
    await g.close();
  });

  it("states the true rule: silence about writable means read-only", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).not.toMatch(/omit it to leave every field writable/i);
    expect(readme).toMatch(/writable/);
    expect(readme, "the manual states the deny-by-default posture").toMatch(
      /omit[^.]{0,80}read-only/i,
    );
  });
});
