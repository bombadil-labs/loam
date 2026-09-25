// The census ratchet: coupling counts that may only fall.
// - Every count must equal `ratchet.json`. A count that falls fails too, until `--write` locks
//   the gain in.
// - Against a base, every count and every baseline value must be at or below the base branch's
//   `ratchet.json`, so a pull request cannot raise the baseline to let a count rise. The base is
//   `--base <ref>`, or on a CI pull request the branch in `GITHUB_BASE_REF`, fetched here. In CI a
//   base that cannot be fetched fails the check.
// Usage: node refactor/tools/ratchet.mjs [--write] [--base <git ref>]

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { couplingCounts, option, sourceFiles } from "./lib.mjs";

const RELATIVE = "refactor/tools/ratchet.json";
const BASELINE = path.join(import.meta.dirname, "ratchet.json");
const args = process.argv.slice(2);
const counts = couplingCounts(sourceFiles("src"));

if (args.includes("--write")) {
  fs.writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`census: wrote ${RELATIVE}`);
  process.exit(0);
}

const failures = [];
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
for (const [name, now] of Object.entries(counts)) {
  const was = baseline[name];
  if (was === undefined) failures.push(`${name} = ${now} has no baseline; run with --write`);
  else if (now > was) failures.push(`${name} rose from ${was} to ${now}. Coupling may only fall.`);
  else if (now < was) failures.push(`${name} fell from ${was} to ${now}. Lock it in: --write.`);
}

const git = (...argv) =>
  execFileSync("git", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

let baseRef = option(args, "--base");
if (args.includes("--base") && (baseRef === undefined || baseRef.startsWith("--"))) {
  failures.push("--base needs a git ref.");
  baseRef = undefined;
}
const ciBase = process.env["GITHUB_BASE_REF"];
if (!args.includes("--base") && ciBase) {
  try {
    execFileSync("git", ["fetch", "--depth=1", "origin", ciBase], { stdio: "ignore" });
    baseRef = "FETCH_HEAD";
  } catch {
    failures.push(`could not fetch the base branch ${ciBase} to hold the counts to it.`);
  }
}
if (baseRef !== undefined) {
  // An unreadable base fails. Only a base commit that genuinely lacks the file passes, because
  // that is the change that introduces the baseline.
  let base;
  let commit;
  try {
    commit = git("rev-parse", "--verify", `${baseRef}^{commit}`).trim();
  } catch {
    failures.push(`the base ${baseRef} is not a commit.`);
  }
  if (commit !== undefined) {
    let present = true;
    try {
      git("cat-file", "-e", `${commit}:${RELATIVE}`);
    } catch {
      present = false;
      console.log(`census: ${baseRef} has no ${RELATIVE}; this change introduces the baseline`);
    }
    if (present) {
      try {
        base = JSON.parse(git("show", `${commit}:${RELATIVE}`));
      } catch {
        failures.push(`the base's ${RELATIVE} cannot be read.`);
      }
    }
  }
  for (const [name, limit] of Object.entries(base ?? {})) {
    if ((baseline[name] ?? 0) > limit) {
      failures.push(`${name}: the baseline was raised from ${limit} to ${baseline[name]}.`);
    }
    if ((counts[name] ?? 0) > limit) {
      failures.push(`${name} is ${counts[name]}, above ${limit} on ${baseRef}.`);
    }
  }
}

for (const f of failures) console.log(`census: ${f}`);
if (failures.length === 0) console.log(`census: ${JSON.stringify(counts)}`);
process.exit(failures.length === 0 ? 0 : 2);
