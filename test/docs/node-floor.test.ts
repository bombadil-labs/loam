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

    const stated = /Node\s*≥\s*([\d.]+)/.exec(read("README.md"));
    expect(stated, "the README states a Node floor").not.toBeNull();
    expect(stated![1], "the README's floor is package.json's floor").toBe(enforced![1]);
  });
});
