import { termToJson, type Term } from "@bombadil/rhizomatic";

export function programMaskJson(body: Term): unknown {
  const policies = new Map<string, unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || Array.isArray(node)) return;
    const rec = node as Record<string, unknown>;
    if (rec.op === "mask" && "policy" in rec) policies.set(JSON.stringify(rec.policy), rec.policy);
    for (const key of ["in", "left", "right", "of", "without"]) walk(rec[key]);
  };
  walk(termToJson(body));
  if (policies.size > 1) {
    throw new Error(
      `the hyperschema body masks negations ${policies.size} different ways, and a listing has ` +
        `one candidate set — it cannot suppress by two rules at once. Give the program a single ` +
        `mask, or leave this hyperschema unlisted.`,
    );
  }
  return [...policies.values()][0];
}
