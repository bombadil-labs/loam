#!/usr/bin/env node
// The commit-time rail backstop. ADLC is explicit that the plugin's PreToolUse hook is only the
// in-session layer and that **Bash is not gated in-session** — a shell cannot be reliably parsed, so
// a rail edited through a shell command is caught by nothing but a diff gate in CI. This is that
// gate.
//
// WHY A WRAPPER RATHER THAN `adlc rails-guard` DIRECTLY. The bare gate needs `--ticket` or `--rails`
// and will not scan the store, so CI has nothing to point it at; and it counts an ADDED file as a
// rail edit, which is correct for its purpose and fatal for ours — the PR that first writes a
// ticket's rails would fail its own gate, every time.
//
// AND THERE IS NO GENERAL ESCAPE HATCH. The installed `@adlc/rails-guard` reads no environment
// override at all (`ADLC_RAILS_BYPASS` lives in `@adlc/build-gate`, a different gate), and this
// wrapper adds none. What it adds instead is ONE narrow, mechanical exemption (Myk, 2026-07-26):
// an AUTHORIZED VOCABULARY RENAME. When the language retires a word that frozen rails quote — the
// posture rename was the motivating case — the substitution is declared in
// `scripts/rail-renames.json`, and a frozen-rail edit is exempt iff base + the declared
// substitutions is byte-identical to the branch's file (directly, or after the repo's own
// prettier). Everything else about the edit remains a violation.
//
// THE DECLARATION IS READ FROM THE BASE TREE, NEVER FROM THE BRANCH — the same rule the frozen set
// itself lives by, for the same reason: only the base can say what a branch may touch. A branch
// that declares its own exemption changes nothing; the authorization must already have merged
// through a PR a human read. So the discipline is two PRs: land the rename declaration, then land
// the rename. A red gate always means stop, in every future context window, with no lore required
// about which red was blessed.
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

// ── Authorized renames: the one exemption, applied by SYNTHESIZING a base ─────────────────────
//
// Rather than teaching the downstream gate to skip files (it has no such flag, and a skip is a
// hole), exempt files are folded into a synthetic base commit whose tree already carries the
// branch's bytes for them. The diff the gate then sees is empty exactly where the exemption
// held and unchanged everywhere else — suppression scanning and every other check keep running.
const liveRes = live.map(({ glob }) => toRegExp(glob));
const changed = git(["diff", "--name-only", base])
  .split("\n")
  .filter(Boolean)
  .filter((f) => liveRes.some((re) => re.test(f)));

let effectiveBase = base;
if (changed.length > 0) {
  // The declarations, FROM THE BASE TREE. A missing file means no renames are authorized.
  let renames = [];
  try {
    // stderr piped, not inherited: a repo with no declarations file is the normal state, and
    // git's `fatal:` for it would read as an error in every CI log.
    renames =
      JSON.parse(
        execFileSync("git", ["show", `${base}:scripts/rail-renames.json`], {
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        }),
      ).renames ?? [];
  } catch {
    /* not on base: nothing is authorized, every frozen edit is a plain violation */
  }
  // Shape guards. An UNSCOPED pair touches every frozen rail, so it must be word-shaped — an
  // identifier or a quoted literal. A SCOPED pair names its files and the reviewer reads it
  // against exactly those, so it may carry wider literals (a regex fragment, a title phrase).
  // Malformed entries are an OPERATIONAL failure: an authorization the gate cannot read must
  // stop the build, not silently authorize nothing.
  const TIGHT = /^"?[A-Za-z][A-Za-z0-9_.:-]{0,62}"?$/;
  const WIDE = /^[\x20-\x7E]{3,120}$/;
  for (const r of renames) {
    const scoped = Array.isArray(r.files) && r.files.length > 0;
    const shape = scoped ? WIDE : TIGHT;
    const quoteParity = (t) => (t.startsWith('"') ? 1 : 0) + (t.endsWith('"') ? 1 : 0) !== 1;
    const ok =
      typeof r.from === "string" &&
      typeof r.to === "string" &&
      r.from !== r.to &&
      shape.test(r.from) &&
      shape.test(r.to) &&
      (scoped || (quoteParity(r.from) && quoteParity(r.to))) &&
      typeof r.authorized === "string" &&
      r.authorized.trim() !== "";
    if (!ok) {
      console.error(
        `rails-guard-ci: malformed entry in scripts/rail-renames.json on ${base} ` +
          `(from=${JSON.stringify(r.from)}) — refusing to guess what is authorized`,
      );
      process.exit(1);
    }
  }

  const { readFileSync, existsSync } = await import("node:fs");
  let prettier = null;
  try {
    prettier = (await import("prettier")).default ?? (await import("prettier"));
  } catch {
    /* no node_modules here: the raw compare still runs; a rewrapped rename just stays a violation */
  }

  const exempt = [];
  for (const file of changed) {
    const pairs = renames.filter((r) => !Array.isArray(r.files) || r.files.includes(file));
    if (pairs.length === 0 || !existsSync(file)) continue; // deleted or undeclared: not a rename
    let baseContent;
    try {
      baseContent = git(["show", `${base}:${file}`]);
    } catch {
      continue; // added under a frozen glob — first-authoring, the gate downstream decides
    }
    const branchContent = readFileSync(file, "utf8");
    let substituted = baseContent;
    for (const { from, to } of pairs) substituted = substituted.split(from).join(to);
    let how = substituted === branchContent ? "byte-identical" : null;
    if (how === null && prettier !== null) {
      try {
        const cfg = await prettier.resolveConfig(file);
        if ((await prettier.format(substituted, { ...cfg, filepath: file })) === branchContent)
          how = "byte-identical after the repo's own prettier";
      } catch {
        /* unformattable: stays a violation */
      }
    }
    if (how === null) {
      console.log(
        `rails-guard-ci: ${file} is a frozen rail and its edit is NOT a declared rename — ` +
          `the gate below will refuse it`,
      );
      continue;
    }
    exempt.push(file);
    console.log(`rails-guard-ci: EXEMPT (authorized rename) ${file}`);
    console.log(`  base + { ${pairs.map((p) => `${p.from} → ${p.to}`).join(", ")} } is ${how}`);
    for (const a of new Set(pairs.map((p) => p.authorized))) console.log(`  authorized: ${a}`);
  }

  if (exempt.length > 0) {
    const { mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const baseSha = git(["rev-parse", base]).trim();
    const indexFile = join(mkdtempSync(join(tmpdir(), "rails-guard-ci-")), "index");
    // The synthetic commit is throwaway plumbing and must not depend on the runner's git identity —
    // CI runners have none, and `commit-tree` refuses with "empty ident name" (found the honest way:
    // the fixtures configured identities for their own setup commits, which masked exactly this).
    const env = {
      ...process.env,
      GIT_INDEX_FILE: indexFile,
      GIT_AUTHOR_NAME: "rails-guard-ci",
      GIT_AUTHOR_EMAIL: "rails-guard-ci@loam.invalid",
      GIT_COMMITTER_NAME: "rails-guard-ci",
      GIT_COMMITTER_EMAIL: "rails-guard-ci@loam.invalid",
    };
    const gitEnv = (args, input) =>
      execFileSync("git", args, { encoding: "utf8", env, ...(input !== undefined && { input }) });
    gitEnv(["read-tree", baseSha]);
    for (const file of exempt) {
      const blob = gitEnv(["hash-object", "-w", "--stdin"], readFileSync(file, "utf8")).trim();
      gitEnv(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`]);
    }
    const tree = gitEnv(["write-tree"]).trim();
    effectiveBase = gitEnv([
      "commit-tree",
      tree,
      "-p",
      baseSha,
      "-m",
      "rails-guard-ci: synthetic base carrying authorized renames",
    ]).trim();
    console.log(
      `rails-guard-ci: gating against a synthetic base (${effectiveBase.slice(0, 12)}) that ` +
        `carries the ${exempt.length} authorized rename(s); every other check is unchanged`,
    );
  }
}

const args = ["rails-guard", "--base", effectiveBase];
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
