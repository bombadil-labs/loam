// Scratch (not for merge): read vitest JSON reports out-*.json and print one line per iteration.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const TARGETS = ["drop-cli.test.ts", "user-roles.test.ts", "install-by-federation-cli.test.ts"];
let fails = 0, iters = 0;
const files = readdirSync(dir).filter((f) => /^out-\d+\.json$/.test(f)).sort((a, b) => parseInt(a.slice(4)) - parseInt(b.slice(4)));
for (const f of files) {
  iters++;
  const r = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const tests = r.testResults.flatMap((tr) => tr.assertionResults.map((a) => ({ file: tr.name.replace(/.*[\\/]test[\\/]/, ""), ...a })));
  const failed = tests.filter((t) => t.status === "failed");
  if (failed.length) fails++;
  const slowest = tests.reduce((m, t) => ((t.duration ?? 0) > (m.duration ?? 0) ? t : m), {});
  const tmax = TARGETS.map((x) => Math.max(0, ...tests.filter((t) => t.file.endsWith(x)).map((t) => t.duration ?? 0)).toFixed(0));
  console.log(`${f}: ${failed.length ? "FAIL" : "pass"} | target max ms [drop-cli ${tmax[0]}, user-roles ${tmax[1]}, install-cli ${tmax[2]}] | slowest ${slowest.file} ${(slowest.duration ?? 0).toFixed(0)}ms` +
    failed.map((t) => `\n    x ${t.file} > ${t.title}: ${(t.failureMessages ?? []).join(" ").split("\n")[0].slice(0, 160)}`).join(""));
}
console.log(`SUMMARY ${dir}: ${iters - fails}/${iters} iterations green`);
