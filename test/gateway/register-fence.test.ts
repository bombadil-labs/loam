// T174 — the `register` verb and its prefix fence, at the DELTA level.
//
// This file asserts the vocabulary and the fence predicate directly: what a register grant looks
// like in the bytes, what `constitutionalDefect` refuses, and exactly which names a prefix admits.
// `test/server/register-verb.test.ts` asks the OBJECT-level question — what a door serves and what
// it refuses — because a correct predicate wired to the wrong door is the failure this level cannot
// see. Neither file is sufficient alone.
//
// The expected admit/refuse table is written out by hand below rather than derived from
// `fenceAdmits`, so a fence that stopped fencing cannot rewrite its own expectations (H10).

import { describe, expect, it } from "vitest";
import { authorForSeed, makeDelta, signClaims } from "@bombadil/rhizomatic";
import {
  constitutionalDefect,
  fenceAdmits,
  grantClaims,
  grantsHeldBy,
  registerPrefixesOf,
  revocationClaims,
} from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const CONNECTOR = authorForSeed("c0".repeat(32));
const BYSTANDER = authorForSeed("b7".repeat(32));

describe("T174 — the fence is a literal code-unit prefix on the hyperschema name", () => {
  // The hand-written table. Each row is a decision, not a derivation: the prefix, the proposed
  // name, and whether the fence lets it through. Read it as the specification of `fenceAdmits`.
  const ADMITTED: readonly (readonly [string, string])[] = [
    ["thread:", "thread:groove"],
    ["thread:", "thread:groove:2"],
    ["thread:", "thread:"], // the bare prefix is inside its own fence
    ["thread:", "thread:x@y"], // `@` is not special to the fence; the derived ids stay prefixed
    ["thread", "thread:groove"], // a prefix need not end at a separator
  ];
  const REFUSED: readonly (readonly [string, string])[] = [
    ["thread:", "note:anything"], // a different scope
    ["thread:", "Groove"], // root — no namespace at all
    ["thread:", "x-thread:foo"], // the prefix appears LATER: not a prefix
    ["thread:", " thread:foo"], // leading space
    ["thread:", "thread"], // shorter than the prefix
    ["thread:", "Thread:foo"], // ASCII case is significant
    ["thread:", "thread%3Afoo"], // percent-encoding is not decoded — this is a different name
    ["thread:", "thread:foo".replace(":", "：")], // fullwidth colon is a different code point
    ["", "anything"], // an empty prefix fences nothing, so it admits nothing
    ["", ""],
  ];

  for (const [prefix, name] of ADMITTED) {
    it(`prefix ${JSON.stringify(prefix)} admits ${JSON.stringify(name)}`, () => {
      expect(fenceAdmits(prefix, name)).toBe(true);
    });
  }
  for (const [prefix, name] of REFUSED) {
    it(`prefix ${JSON.stringify(prefix)} refuses ${JSON.stringify(name)}`, () => {
      expect(fenceAdmits(prefix, name)).toBe(false);
    });
  }

  it("the table is not vacuous: both halves carry cases", () => {
    expect(ADMITTED.length).toBeGreaterThanOrEqual(5);
    expect(REFUSED.length).toBeGreaterThanOrEqual(9);
  });
});

describe("T174 — a register grant is malformed law without exactly one non-empty prefix", () => {
  const grant = (verb: "write" | "admin" | "register", prefix?: string) =>
    makeDelta(grantClaims(STORE_ENTITY, CONNECTOR, verb, OPERATOR, 1, prefix));

  it("register + a prefix is well-formed law", () => {
    expect(constitutionalDefect(grant("register", "thread:"))).toBeUndefined();
  });

  it("register with NO prefix is REFUSED, not read as unrestricted", () => {
    // Fail closed at the mint. The alternative — treating a prefixless register grant as
    // meaningless — leaves a grant-shaped delta sitting in the audit that a later reader could
    // just as easily read as root authority. Malformed law is refused for everyone.
    const defect = constitutionalDefect(grant("register"));
    expect(defect).toBeDefined();
    expect(defect).toContain("prefix");
  });

  it("register with an EMPTY prefix is refused", () => {
    expect(constitutionalDefect(grant("register", ""))).toContain("prefix");
  });

  it("a write or admin grant carrying a prefix is refused — a prefix it ignores would be a lie", () => {
    expect(constitutionalDefect(grant("write", "thread:"))).toBeDefined();
    expect(constitutionalDefect(grant("admin", "thread:"))).toBeDefined();
  });

  it("write and admin are unchanged: no prefix, no defect", () => {
    expect(constitutionalDefect(grant("write"))).toBeUndefined();
    expect(constitutionalDefect(grant("admin"))).toBeUndefined();
  });

  it("an unknown verb is still refused, and the message names the three that exist", () => {
    const bogus = makeDelta({
      timestamp: 1,
      author: OPERATOR,
      pointers: [
        {
          role: "tenant",
          target: { kind: "entity", entity: { id: STORE_ENTITY, context: "loam.grants" } },
        },
        { role: "subject", target: { kind: "primitive", value: CONNECTOR } },
        { role: "verb", target: { kind: "primitive", value: "erase" } },
      ],
    });
    const defect = constitutionalDefect(bogus);
    expect(defect).toContain("write");
    expect(defect).toContain("admin");
    expect(defect).toContain("register");
  });
});

describe("T174 — register standing, read from the ground", () => {
  const open = async (): Promise<Gateway> =>
    Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });

  it("a surviving register grant answers its prefix; a bystander answers nothing", async () => {
    const gw = await open();
    await gw.append([
      signClaims(
        grantClaims(STORE_ENTITY, CONNECTOR, "register", OPERATOR, 100, "thread:"),
        OPERATOR_SEED,
      ),
    ]);
    expect(registerPrefixesOf(gw.reactor, CONNECTOR, OPERATOR)).toEqual(["thread:"]);
    expect(registerPrefixesOf(gw.reactor, BYSTANDER, OPERATOR)).toEqual([]);
    await gw.close();
  });

  it("ADMIN DOES NOT COVER REGISTER — an admin grant carries no prefix, so it could only mean root", async () => {
    const gw = await open();
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, CONNECTOR, "admin", OPERATOR, 100), OPERATOR_SEED),
    ]);
    expect(registerPrefixesOf(gw.reactor, CONNECTOR, OPERATOR)).toEqual([]);
    await gw.close();
  });

  it("a revocation kills the standing, and a named bystander's standing survives it", async () => {
    const gw = await open();
    const held = signClaims(
      grantClaims(STORE_ENTITY, CONNECTOR, "register", OPERATOR, 100, "thread:"),
      OPERATOR_SEED,
    );
    const other = signClaims(
      grantClaims(STORE_ENTITY, BYSTANDER, "register", OPERATOR, 101, "note:"),
      OPERATOR_SEED,
    );
    await gw.append([held, other]);
    expect(registerPrefixesOf(gw.reactor, CONNECTOR, OPERATOR)).toEqual(["thread:"]);

    await gw.append([signClaims(revocationClaims(held.id, OPERATOR, 200), OPERATOR_SEED)]);
    expect(registerPrefixesOf(gw.reactor, CONNECTOR, OPERATOR)).toEqual([]);
    // Two-sided: the strike took its target and nothing else.
    expect(registerPrefixesOf(gw.reactor, BYSTANDER, OPERATOR)).toEqual(["note:"]);
    await gw.close();
  });

  it("`grant list`'s reading and the door's reading come from ONE derivation", async () => {
    const gw = await open();
    await gw.append([
      signClaims(grantClaims(STORE_ENTITY, CONNECTOR, "write", OPERATOR, 100), OPERATOR_SEED),
      signClaims(
        grantClaims(STORE_ENTITY, CONNECTOR, "register", OPERATOR, 101, "thread:"),
        OPERATOR_SEED,
      ),
    ]);
    const held = grantsHeldBy(gw.reactor, CONNECTOR, OPERATOR);
    expect(held.map((g) => g.verb).sort()).toEqual(["register", "write"]);
    expect(held.find((g) => g.verb === "register")?.prefix).toBe("thread:");
    expect(held.find((g) => g.verb === "write")?.prefix).toBeUndefined();
    await gw.close();
  });
});
