// The Node floor, stated once (T84). `package.json`'s `engines.node` is the enforced floor — npm
// refuses an install below it — and the README's install line is the floor a reader provisions
// against. They drifted: the floor rose to 24 with the workflows, the Dockerfile, and the spec,
// and the README kept promising 22.13, which is a version the green bar has never run.
//
// This is a docs-consistency rail, and it belongs for the same reason test/cli/pack.test.ts pins
// the shipped `files`/`bin`/`exports` surface: the fact is machine-checkable, single-valued, and
// the only cheap way to make a reader's copy of it stay true. It asserts AGREEMENT, not a literal —
// raising the floor again passes as long as both places move.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");

describe("the Node floor", () => {
  it("the README's stated floor is the one package.json enforces", () => {
    const engines = (JSON.parse(read("package.json")) as { engines: { node: string } }).engines
      .node;
    const enforced = /^>=\s*([\d.]+)$/.exec(engines);
    expect(enforced, `engines.node is a simple floor, not ${engines}`).not.toBeNull();

    // The README's install line: "Loam is a Node package (Node ≥ 24) …"
    const stated = /Node\s*≥\s*([\d.]+)/.exec(read("README.md"));
    expect(stated, "the README states a Node floor").not.toBeNull();
    expect(stated![1], "the README's floor is package.json's floor").toBe(enforced![1]);
  });
});
