// Step 12's contract: writes become claims. A schema is a PROTOCOL — the read program (the
// body) and the write discipline (claim templates), both data, both traveling in the
// registration. A template mutation emits ONE signed multi-pointer delta shaped exactly as
// declared; the generic `_claim` covers shapes no template anticipated; `_hviewHex` sits
// beside `_hex` so two lenses can prove they read the same gathered ground.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { registrationClaims, type ClaimTemplates } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { PLANT, PLANT_POLICY, pickLatest } from "./fixtures.js";
import { FERN } from "../spike/garden.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const MILES_SEED = "22".repeat(32);
const MILES = authorForSeed(MILES_SEED);
const MALLORY_SEED = "ee".repeat(32);

const ALL = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } } as const;

// The Evening schema: a person's social calendar, written through ONE template.
const EVENING_TEMPLATES: ClaimTemplates = {
  hostScreening: {
    pointers: [
      { role: "host", at: { arg: "host" }, context: "events_hosted" },
      { role: "film", at: { arg: "film" }, context: "screenings" },
      { role: "guest", at: { arg: "guests" }, context: "events_attended", each: true },
      { role: "date", value: { arg: "date" } },
      { role: "kind", value: "screening" }, // a literal: no arg, always stamped
    ],
  },
};

async function eveningWorld(): Promise<Gateway> {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, MILES, "write", OPERATOR, 1), OPERATOR_SEED),
  ]);
  await gateway.publishRegistration(
    { ...PLANT, name: "Evening" },
    {
      props: new Map([
        ["events_hosted", ALL],
        ["events_attended", ALL],
      ]),
      default: pickLatest,
    },
    ["person:miles", "person:wren"],
    undefined,
    undefined,
    EVENING_TEMPLATES,
  );
  return gateway;
}

describe("claim templates: the write discipline travels with the schema", () => {
  it("one call, one delta, exactly the declared shape — signed by the actor", async () => {
    const gateway = await eveningWorld();
    const before = new Set([...gateway.reactor.snapshot()].map((d) => d.id));
    const result = await gateway.query(
      `mutation { hostScreening(host: "person:miles", film: "film:the-matrix",
        guests: ["person:wren", "person:sally"], date: "2026-07-04") { delta } }`,
      undefined,
      { actor: MILES_SEED },
    );
    expect(result.errors).toBeUndefined();
    const deltaId = (result.data as { hostScreening: { delta: string } }).hostScreening.delta;
    const landed = [...gateway.reactor.snapshot()].filter((d) => !before.has(d.id));
    expect(landed).toHaveLength(1); // ONE delta — the whole point
    expect(landed[0]!.id).toBe(deltaId);
    expect(landed[0]!.claims.author).toBe(MILES);

    const ptrs = landed[0]!.claims.pointers;
    const ofRole = (role: string) => ptrs.filter((p) => p.role === role);
    expect(ofRole("host")).toHaveLength(1);
    expect(ofRole("guest")).toHaveLength(2); // `each` expanded the array
    const host = ofRole("host")[0]!;
    expect(host.target.kind === "entity" && host.target.entity).toEqual({
      id: "person:miles",
      context: "events_hosted",
    });
    const date = ofRole("date")[0]!;
    expect(date.target.kind === "primitive" && date.target.value).toBe("2026-07-04");
    const kind = ofRole("kind")[0]!;
    expect(kind.target.kind === "primitive" && kind.target.value).toBe("screening");

    // and the fact resolves from the OTHER end too — one delta, many views: at Wren's root the
    // entry reads as the event FROM HER PERSPECTIVE (host, film, the other guest, the date; her
    // own anchoring pointer elided)
    const wren = await gateway.query(`{ evening(entity: "person:wren") { events_attended } }`);
    const attended = JSON.stringify(wren.data);
    expect(attended).toContain("person:miles");
    expect(attended).toContain("2026-07-04");
    await gateway.close();
  });

  it("standing still gates the door: a template call without it is refused", async () => {
    const gateway = await eveningWorld();
    const denied = await gateway.query(
      `mutation { hostScreening(host: "person:m", film: "film:x", guests: [], date: "d") { delta } }`,
      undefined,
      { actor: MALLORY_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("a template whose output its own schema cannot see is refused at publish", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    const blind: ClaimTemplates = {
      orphanNote: { pointers: [{ role: "note", value: { arg: "note" } }] }, // no entity pointer
    };
    await expect(
      gateway.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, blind),
    ).rejects.toThrow(/template/);
    await gateway.close();
  });

  it("a malformed template in a stored registration is dropped; the schema still binds", async () => {
    const backend = new MemoryBackend();
    const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
    // hand-plant a registration whose mutations payload is garbage (past publish's guards)
    const { publishSchemaClaims } = await import("@bombadil/rhizomatic");
    await gateway.append([
      signClaims(publishSchemaClaims(PLANT, "schema:Plant", OPERATOR, 1), OPERATOR_SEED),
      signClaims(
        {
          ...registrationClaims("schema:Plant", PLANT_POLICY, [FERN], OPERATOR, 2),
          pointers: [
            ...registrationClaims("schema:Plant", PLANT_POLICY, [FERN], OPERATOR, 2).pointers,
            { role: "mutations", target: { kind: "primitive", value: "][ not json" } },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    await gateway.flush();
    const reopened = await Gateway.open(backend, { seed: OPERATOR_SEED });
    const read = await reopened.query(`{ plant(entity: "${FERN}") { height } }`);
    expect(read.errors).toBeUndefined(); // the schema bound; the poison template just fell away
    await gateway.close();
    await reopened.close();
  });

  it("templates evolve with the registration: a republish reshapes the mutation surface", async () => {
    const gateway = await eveningWorld();
    const renamed: ClaimTemplates = {
      logEvening: EVENING_TEMPLATES["hostScreening"]!,
    };
    await gateway.publishRegistration(
      { ...PLANT, name: "Evening" },
      {
        props: new Map([
          ["events_hosted", ALL],
          ["events_attended", ALL],
        ]),
        default: pickLatest,
      },
      ["person:miles", "person:wren"],
      undefined,
      undefined,
      renamed,
    );
    const old = await gateway.query(
      `mutation { hostScreening(host: "x", film: "y", guests: [], date: "d") { delta } }`,
    );
    expect(old.errors?.join(" ")).toMatch(/Cannot query field "hostScreening"/);
    const now = await gateway.query(
      `mutation { logEvening(host: "person:miles", film: "film:z", guests: [], date: "d") { delta } }`,
    );
    expect(now.errors).toBeUndefined();
    await gateway.close();
  });
});

describe("_claim: the generic pointer mutation", () => {
  it("an unanticipated shape lands as one delta, with standing", async () => {
    const gateway = await eveningWorld();
    const result = await gateway.query(
      `mutation { _claim(pointers: [
        { role: "subject", at: "plant:fern", context: "height" },
        { role: "value", value: 41 },
        { role: "witnessed_by", at: "person:miles", context: "witnessed" }
      ]) { delta } }`,
      undefined,
      { actor: MILES_SEED },
    );
    expect(result.errors).toBeUndefined();
    const id = (result.data as { _claim: { delta: string } })._claim.delta;
    const delta = [...gateway.reactor.snapshot()].find((d) => d.id === id)!;
    expect(delta.claims.pointers).toHaveLength(3);
    expect(delta.claims.author).toBe(MILES);

    const denied = await gateway.query(
      `mutation { _claim(pointers: [{ role: "x", at: "e:1", context: "c" }]) { delta } }`,
      undefined,
      { actor: MALLORY_SEED },
    );
    expect(denied.errors?.join(" ")).toMatch(/not permitted/);
    await gateway.close();
  });

  it("a pointer must be entity or primitive, not both, not neither", async () => {
    const gateway = await eveningWorld();
    const neither = await gateway.query(`mutation { _claim(pointers: [{ role: "x" }]) { delta } }`);
    expect(neither.errors?.join(" ")).toMatch(/at|value/);
    const both = await gateway.query(
      `mutation { _claim(pointers: [{ role: "x", at: "e:1", context: "c", value: 1 }]) { delta } }`,
    );
    expect(both.errors?.join(" ")).toMatch(/at|value/);
    await gateway.close();
  });
});

describe("_hviewHex: same evidence, many answers", () => {
  it("two lenses over one body share _hviewHex; _hex diverges when policies truly differ", async () => {
    const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
    gateway.register(PLANT, PLANT_POLICY, [FERN]);
    gateway.register(
      { ...PLANT, name: "PlantCount" },
      { props: new Map([["height", { kind: "merge", fn: "count" }]]), default: pickLatest },
      [FERN],
    );
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 30) { height } }`);
    await gateway.query(`mutation { plant(entity: "${FERN}", height: 34) { height } }`);

    const a = (await gateway.query(`{ plant(entity: "${FERN}") { _hex _hviewHex } }`)).data as {
      plant: { _hex: string; _hviewHex: string };
    };
    const b = (await gateway.query(`{ plantCount(entity: "${FERN}") { _hex _hviewHex } }`))
      .data as { plantCount: { _hex: string; _hviewHex: string } };
    expect(a.plant._hviewHex).toBe(b.plantCount._hviewHex); // one gathered ground
    expect(a.plant._hex).not.toBe(b.plantCount._hex); // two adjudications (latest=34 vs count=2)
    await gateway.close();
  });
});
