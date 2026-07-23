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
// FROZEN MEANS DECLARED ON THE BASE, NOT MERELY PRESENT ON IT — the definition is two-sided:
//
//   - Too strict: rails usually land inside a suite that already exists on the base (the point of
//     a contract suite), so a gate keyed on the FILE's presence makes a PR that declares and
//     extends such a suite fail its own gate — the every-ticket bypass again, moved from added
//     files to extended ones.
//   - Too lax: declarations read from the WORKING store let a branch delete a ticket's `rails`
//     entry and then edit the file freely. Only the base can say what the base froze.
//
// So the guarded set is computed from the base tree's own ticket shards — and the freeze survives
// the ticket's landing: P6 archives the realized ticket into `.adlc/ticket-archive/`, and this
// gate reads BOTH directories, so a live ticket's rails and a landed ticket's rails are equally
// frozen. A branch can neither un-declare nor un-archive its way out; the union is computed from
// the base tree, same as everything else here.
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
  // BOTH directories, one rule: live tickets (`tickets/`) and landed ones (`ticket-archive/`)
  // freeze their rails identically. Only the live store's absence is worth flagging — an empty
  // archive is the normal state of a young repo, not a signal.
  const shards = git([
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    ".adlc/tickets/",
    ".adlc/ticket-archive/",
  ])
    .split("\n")
    .filter((p) => p.endsWith(".json") && !p.endsWith("/.store.json"));
  // One `git cat-file --batch` for every shard, not one `git show` each: tombstones and archived
  // tickets accumulate, so the per-shard spawn is the shape that grows forever (H8). Batch output
  // is length-prefixed and sliced as BYTES before decoding: ticket bodies carry multi-byte
  // characters, and a char-indexed slice would tear the record after them.
  tickets = [];
  const raw = execFileSync("git", ["cat-file", "--batch"], {
    input: shards.map((p) => `${base}:${p}`).join("\n"),
    maxBuffer: 64 * 1024 * 1024,
  });
  let at = 0;
  for (const path of shards) {
    // FAIL CLOSED on output this parser cannot account for. A truncated or malformed record here
    // would otherwise corrupt the offset and leave every LATER shard unread — and unread shards
    // mean undeclared rails, so the gate would quietly guard less than the base froze. A gate that
    // cannot read its inputs has no verdict to give; exit 1 says so in the operational lane.
    const nl = raw.indexOf(0x0a, at);
    if (nl === -1) {
      console.error(
        `rails-guard-ci: malformed cat-file output at ${path} — refusing to guess what is frozen`,
      );
      process.exit(1);
    }
    const header = raw.subarray(at, nl).toString("utf8");
    at = nl + 1;
    if (/ (missing|ambiguous)$/.test(header)) {
      console.log(`rails-guard-ci: skipping unreadable shard on ${base}: ${path}`);
      continue;
    }
    const size = Number(header.split(" ")[2]);
    if (!Number.isInteger(size) || size < 0 || at + size > raw.length) {
      console.error(
        `rails-guard-ci: malformed cat-file record for ${path} — refusing to guess what is frozen`,
      );
      process.exit(1);
    }
    const body = raw.subarray(at, at + size).toString("utf8");
    at += size + 1; // the record's trailing newline
    try {
      const t = JSON.parse(body);
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
