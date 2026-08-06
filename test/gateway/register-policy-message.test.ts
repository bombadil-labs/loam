// T150 item 1 — the register door names a malformed Policy's prop path and the accepted shapes,
// so a registry author can act without reading rhizomatic's parser. This file is the rail: the
// message must stay verbatim enough to go red on regression.

import { describe, expect, it } from "vitest";
import { parseRegistrationInput } from "../../src/gateway/registration.js";

const GOOD = {
  hyperschema: { name: "Plant", body: { op: "mask", policy: "drop", in: "input" } },
  schema: {
    props: { height: { pick: { order: { byTimestamp: "desc" } } } },
    default: { pick: { order: { byTimestamp: "desc" } } },
  },
  roots: ["plant:fern"],
};

describe("the register door names a malformed Policy", () => {
  it("parses a well-formed schema unchanged", () => {
    const input = parseRegistrationInput(GOOD);
    expect(input.schema.props.get("height")).toEqual({
      kind: "pick",
      order: { kind: "byTimestamp", dir: "desc" },
    });
  });

  it("a bad order names the prop path and the accepted Policy kinds", () => {
    const bad = {
      ...GOOD,
      schema: {
        props: { height: { pick: { order: "desc" } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    };
    expect(() => parseRegistrationInput(bad)).toThrow(/schema\.props\.height/);
    expect(() => parseRegistrationInput(bad)).toThrow(/pick:|all:|merge:|conflicts:|absentAs:/);
  });

  it("a malformed default names schema.default, not a prop", () => {
    const bad = {
      ...GOOD,
      schema: { props: { height: { pick: { order: { byTimestamp: "desc" } } } }, default: "desc" },
    };
    expect(() => parseRegistrationInput(bad)).toThrow(/schema\.default/);
  });

  it("a wrong-kind Policy names the prop that held it", () => {
    const bad = {
      ...GOOD,
      schema: {
        props: {
          height: { pick: { order: { byTimestamp: "desc" } } },
          width: { merge: "not-a-fn" },
        },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    };
    expect(() => parseRegistrationInput(bad)).toThrow(/schema\.props\.width/);
  });
});
