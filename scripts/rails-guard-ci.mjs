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
// So this narrows the question to the one CI can answer honestly: **of the rails the base already
// FROZE, did this branch touch any?** First-authoring is invisible (nothing to protect yet); from
// the merge onward the file is frozen and any edit fails the build. That is a real backstop with no
// false positive, at the cost of not guarding the authoring commit itself — which the in-session
// hook already covers, and which a reviewer reads directly.
//
// FROZEN MEANS DECLARED ON THE BASE, NOT MERELY PRESENT ON IT. The first version asked only whether
// the rail's FILE existed on the base, and read the declarations from the WORKING store. Both halves
// were wrong, in opposite directions:
//
//   - Too strict. A ticket earns its rails at P3 by writing tests, and those tests usually land
//     inside a suite that already exists (`test/store/contract.test.ts` is where a seam contract is
//     witnessed — that is the point of a contract suite). Declaring such a file and extending it in
//     the same PR made the PR fail its own gate, which is precisely the every-ticket bypass the
//     paragraph above exists to prevent. It just moved from added files to extended ones.
//   - Too lax. Reading declarations from the working store let a branch DELETE a ticket's `rails`
//     entry and then edit the file freely — the freeze evaporated on request. Asking the base what
//     was frozen closes that: a branch cannot un-declare its way out of a rail it inherited.
//
// So the guarded set is computed from the base tree's own ticket shards. A rail becomes frozen at
// the merge that declares it, and stays frozen no matter what the branch says about it afterward.
//
// Exit codes are rails-guard's own: 0 pass, 1 operational, 2 a rail was edited.

import { execFileSync } from "node:child_process";

const base = process.argv[2] ?? "origin/main";

const git = (args) => execFileSync("git", args, { encoding: "utf8" });

let baseFiles;
try {
  baseFiles = git(["ls-tree", "-r", "--name-only", base]).split("\n").filter(Boolean);
} catch (err) {
  console.error(`rails-guard-ci: cannot read the base tree at ${base}: ${err.message}`);
  process.exit(1);
}

// The tickets AS OF THE BASE — read from the base tree's own shards, because the question is what
// the base froze, and only the base can answer that. `adlc ticket store export` reads the working
// store, which is the wrong store here however convenient its shape: a branch may add, remove, or
// rewrite declarations, and every one of those edits is exactly what this gate must not consult.
// There is no `store export --ref`, so the shards are read directly; `.store.json` is the directory
// header, not a ticket, and anything unparseable is skipped rather than allowed to fail the build
// (a malformed shard on the BASE is history, and cannot be fixed by the branch being gated).
let tickets;
try {
  const shards = git(["ls-tree", "-r", "--name-only", base, "--", ".adlc/tickets/"])
    .split("\n")
    .filter((p) => p.endsWith(".json") && !p.endsWith("/.store.json"));
  tickets = [];
  for (const path of shards) {
    try {
      const t = JSON.parse(git(["show", `${base}:${path}`]));
      if (t !== null && typeof t === "object" && typeof t.id === "string") tickets.push(t);
    } catch {
      console.log(`rails-guard-ci: skipping unreadable shard on ${base}: ${path}`);
    }
  }
} catch (err) {
  console.error(`rails-guard-ci: cannot read the ticket store at ${base}: ${err.message}`);
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
