#!/usr/bin/env node
// The commit-time rail backstop. ADLC is explicit that the plugin's PreToolUse hook is only the
// in-session layer and that **Bash is not gated in-session** — a shell cannot be reliably parsed, so
// a rail edited through a shell command is caught by nothing but a diff gate in CI. This is that
// gate.
//
// WHY A WRAPPER RATHER THAN `adlc rails-guard` DIRECTLY. The bare gate needs `--ticket` or `--rails`
// and will not scan the store, so CI has nothing to point it at; and it counts an ADDED file as a
// rail edit, which is correct for its purpose and fatal for ours — the PR that first writes a
// ticket's rails would fail its own gate, every time, teaching everyone to reach for
// ADLC_RAILS_BYPASS as routine. A bypass that fires on every ticket is not a bypass.
//
// So this narrows the question to the one CI can answer honestly: **of the rails that already exist
// on the base, did this branch touch any?** First-authoring is invisible (nothing to protect yet);
// from the merge onward the file is frozen and any edit fails the build. That is a real backstop
// with no false positive, at the cost of not guarding the authoring commit itself — which the
// in-session hook already covers, and which a reviewer reads directly.
//
// Exit codes are rails-guard's own: 0 pass, 1 operational, 2 a rail was edited.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "origin/main";

const git = (args) => execFileSync("git", args, { encoding: "utf8" });
const adlc = (args) =>
  execFileSync("adlc", args, { encoding: "utf8", shell: process.platform === "win32" });

let baseFiles;
try {
  baseFiles = git(["ls-tree", "-r", "--name-only", base]).split("\n").filter(Boolean);
} catch (err) {
  console.error(`rails-guard-ci: cannot read the base tree at ${base}: ${err.message}`);
  process.exit(1);
}

// `ticket list --json` returns summaries only (id/title/hash) — no rails. `store export` is the
// one call that yields whole tickets, and it reads through the logical store, so this keeps working
// across a store-backend migration rather than globbing whatever shape .adlc/tickets/ has today.
let tickets;
try {
  const out = mkdtempSync(join(tmpdir(), "rails-guard-ci-"));
  const path = join(out, "export.json");
  adlc(["ticket", "store", "export", "--output", path]);
  tickets = JSON.parse(readFileSync(path, "utf8")).tickets ?? [];
  rmSync(out, { recursive: true, force: true });
} catch (err) {
  console.error(`rails-guard-ci: cannot read the ticket store: ${err.message}`);
  process.exit(1);
}

// Glob semantics deliberately kept to what ticket rails actually use: literal paths, `*` within a
// segment, and `**` across segments. Anything fancier belongs in the gate, not in its caller.
const toRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split("/")
      .map((seg) =>
        seg === "**" ? "[^\\0]*" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
      )
      .join("/")
      .replace(/\[\^\\0\]\*\//g, "(?:.*/)?")}$`,
  );

const declared = [];
for (const ticket of tickets) {
  for (const glob of ticket.rails ?? []) declared.push({ id: ticket.id, glob });
}

if (declared.length === 0) {
  console.log(
    `rails-guard-ci: 0 rails declared across ${tickets.length} ticket(s) — nothing is frozen yet.`,
  );
  process.exit(0);
}

const live = declared.filter(({ glob }) => {
  const re = toRegExp(glob);
  return baseFiles.some((f) => re.test(f));
});
const unborn = declared.filter((d) => !live.includes(d));

for (const { id, glob } of unborn) {
  console.log(`rails-guard-ci: ${id} rail not yet on ${base}, nothing to protect: ${glob}`);
}

if (live.length === 0) {
  console.log(`rails-guard-ci: no declared rail exists on ${base} yet — gate is not yet live.`);
  process.exit(0);
}

const args = ["rails-guard", "--base", base];
for (const { glob } of live) args.push("--rails", glob);
console.log(
  `rails-guard-ci: guarding ${live.length} frozen rail(s) from ${new Set(live.map((d) => d.id)).size} ticket(s) against ${base}`,
);

// Hand the gate's own streams straight through — it already formats violations readably, and
// re-emitting a captured copy printed every one of them twice.
try {
  execFileSync("adlc", args, { stdio: "inherit", shell: process.platform === "win32" });
} catch (err) {
  process.exit(typeof err.status === "number" ? err.status : 1);
}
