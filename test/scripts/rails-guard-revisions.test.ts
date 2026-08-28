// The WHOLE-FILE REVISION exemption's own rails (Myk authorized the class 2026-08-28: the pair
// grammar cannot express a structural split, so a frozen rail may evolve behind a base-declared
// sha256 of its intended bytes). New file beside the frozen rails-guard-ci suite — the frozen
// suite's fixture pattern is replicated here rather than imported, because a frozen file's
// helpers are not an export surface.
//
// What these cases pin: the exemption holds ONLY for the exact declared bytes; any other edit to
// the same file stays a violation; a malformed declaration stops the build operationally rather
// than authorizing nothing in silence; and a branch cannot self-authorize — a declaration that
// exists only on the branch changes nothing. Two-sided throughout: every green here has the red
// beside it.

import { createHash } from "node:crypto";
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });

const WRAPPER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/rails-guard-ci.mjs",
);

const hasAdlc = (() => {
  try {
    execSync("adlc --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (process.env.CI !== undefined && !hasAdlc) {
  throw new Error(
    "the adlc CLI is not on PATH and this is a CI run — the revisions suite must fail closed " +
      "rather than skip: provision @adlc/cli in the test job.",
  );
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots)
    rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const sha256 = (content: string): string => createHash("sha256").update(content).digest("hex");

function fixture(opts: {
  baseTickets?: Record<string, object>;
  baseFiles?: Record<string, string>;
  branchEdits?: Record<string, string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), "loam-revisions-fixture-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  git("init", "-b", "main");
  git("config", "user.email", "fixture@loam.test");
  git("config", "user.name", "fixture");
  const write = (rel: string, content: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  };
  write(".adlc/tickets/.store.json", '{"format":"adlc-ticket-directory","version":1}\n');
  write(".adlc/ticket-archive/.store.json", '{"format":"adlc-ticket-directory","version":1}\n');
  for (const [name, t] of Object.entries(opts.baseTickets ?? {})) {
    write(`.adlc/tickets/${name}`, JSON.stringify(t, null, 2));
  }
  for (const [rel, content] of Object.entries(opts.baseFiles ?? {})) write(rel, content);
  git("add", "-A");
  git("commit", "-m", "base");
  git("checkout", "-b", "feature");
  for (const [rel, content] of Object.entries(opts.branchEdits ?? {})) write(rel, content);
  git("add", "-A");
  git("commit", "-m", "feature work");
  return root;
}

function runGate(root: string): { code: number; out: string } {
  try {
    const out = execFileSync("node", [WRAPPER, "main"], { cwd: root, encoding: "utf8" });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const ticket = (id: string, rails: string[]): object => ({
  id,
  title: `${id} fixture`,
  body: "fixture",
  status: "todo",
  phase: "P3",
  edges: [],
  scope: [],
  rails,
});

const RAIL = "test/frozen.test.ts";
const OLD = "expect(walk()).toBe(true)\n";
const NEW = "// split\nexpect(stepOne()).toBe(true)\nexpect(stepTwo()).toBe(true)\n";

const declaration = (entries: object[]): string =>
  JSON.stringify({ renames: [], revisions: entries }, null, 2);

const revision = (over: Record<string, unknown> = {}): object => ({
  file: RAIL,
  sha256: sha256(NEW),
  authorized: "fixture: Myk merged this declaration",
  ...over,
});

describe.skipIf(!hasAdlc)("rails-guard-ci: the whole-file revision exemption", () => {
  it("GREEN: bytes exactly matching a base-declared sha256 are exempt; the log names the class", () => {
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: { [RAIL]: OLD, "scripts/rail-renames.json": declaration([revision()]) },
      branchEdits: { [RAIL]: NEW },
    });
    const { code, out } = runGate(root);
    expect(out).toContain("EXEMPT (authorized revision)");
    expect(code).toBe(0);
  });

  it("RED: the same declaration, any OTHER bytes — one character past the hash is a violation", () => {
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: { [RAIL]: OLD, "scripts/rail-renames.json": declaration([revision()]) },
      branchEdits: { [RAIL]: `${NEW}// one more line the declaration never blessed\n` },
    });
    const { code, out } = runGate(root);
    expect(out).toContain("the bytes do not match");
    expect(code).toBe(2);
  });

  it("RED: a branch cannot self-authorize — a declaration only on the branch changes nothing", () => {
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: { [RAIL]: OLD },
      branchEdits: {
        [RAIL]: NEW,
        "scripts/rail-renames.json": declaration([revision()]),
      },
    });
    expect(runGate(root).code).toBe(2);
  });

  it("OPERATIONAL: a malformed revision on base stops the build (exit 1), never authorizes silently", () => {
    // A short hash is the honest stand-in for every malformation: an authorization the gate
    // cannot read must stop the build, not quietly authorize nothing (the #493 lesson, at the
    // revision class this time).
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: {
        [RAIL]: OLD,
        "scripts/rail-renames.json": declaration([revision({ sha256: "deadbeef" })]),
      },
      branchEdits: { [RAIL]: NEW },
    });
    const { code, out } = runGate(root);
    expect(out).toContain("malformed revision");
    expect(code).toBe(1);
  });

  it("GREEN two-sided: a stale revision does not shadow a valid rename of the same file", () => {
    // The revision's bytes do not match, but a declared PAIR does reproduce the branch — the
    // fall-through keeps the rename lane open rather than letting a dead declaration block it.
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: {
        [RAIL]: OLD,
        "scripts/rail-renames.json": JSON.stringify(
          {
            renames: [
              {
                from: "walk()",
                to: "walkRenamed()",
                files: [RAIL],
                authorized: "fixture: pair authorized",
              },
            ],
            revisions: [revision({ sha256: sha256("bytes that will never exist") })],
          },
          null,
          2,
        ),
      },
      branchEdits: { [RAIL]: "expect(walkRenamed()).toBe(true)\n" },
    });
    const { code, out } = runGate(root);
    // The fall-through must be OBSERVED, not assumed: this line exists only when the revision
    // lane considered the entry and rejected its bytes before the pairs ran.
    expect(out).toContain("carries a revision declaration but the bytes do not match");
    expect(out).toContain("EXEMPT (authorized rename)");
    expect(code).toBe(0);
  });

  it("RED two-sided: an undeclared file beside an exempt one stays frozen", () => {
    // The revision blesses ONE file's bytes; a second frozen rail edited in the same branch is
    // refused exactly as if no declaration existed — the exemption does not leak sideways.
    const other = "test/other-frozen.test.ts";
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL, other]) },
      baseFiles: {
        [RAIL]: OLD,
        [other]: "expect(untouched()).toBe(true)\n",
        "scripts/rail-renames.json": declaration([revision()]),
      },
      branchEdits: { [RAIL]: NEW, [other]: "expect(edited()).toBe(true)\n" },
    });
    const { code, out } = runGate(root);
    // BOTH halves, or reversion reads the same: without the exemption line this case cannot
    // tell "exemption held and the neighbor was refused" from "nothing was exempt at all".
    expect(out).toContain("EXEMPT (authorized revision)");
    expect(code).toBe(2);
  });

  it("OPERATIONAL: a non-object entry is refused in the guard's own words, never by accident", () => {
    // `revisions: [null]` must die in the shape guard's sentence — an uncaught TypeError also
    // exits 1, but a refusal by accident is one try/catch refactor from a silent authorize.
    const root = fixture({
      baseTickets: { "t1--aaaa.json": ticket("T1", [RAIL]) },
      baseFiles: {
        [RAIL]: OLD,
        "scripts/rail-renames.json": JSON.stringify({ renames: [], revisions: [null] }, null, 2),
      },
      branchEdits: { [RAIL]: NEW },
    });
    const { code, out } = runGate(root);
    expect(out).toContain("malformed revision");
    expect(code).toBe(1);
  });
});

describe.skipIf(hasAdlc)("rails-guard revisions fixture suite", () => {
  it("SKIPPED: the adlc CLI is not installed, and this suite refuses to fake the gate it proves", () => {
    expect(hasAdlc).toBe(false);
  });
});
