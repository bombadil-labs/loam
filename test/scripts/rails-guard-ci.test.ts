// The rail backstop's own rails (ticket T69). The wrapper is trust-root — it decides which frozen
// tests a PR may not touch — and it shipped twice with a freeze that was not one: first freezing on
// file-presence while reading declarations from the WORKING store (a branch could un-declare its
// way out), then reading the base's live tickets only, so the freeze evaporated at the exact moment
// P6 archived the realized ticket. These tests drive the wrapper against real fixture repositories,
// because the failure modes were all in what git state it consulted — a unit test of the glob logic
// would have been green through both bugs.
//
// The wrapper's last step execs the real `adlc` CLI, so these tests need it on PATH; they skip
// loudly when it is absent rather than fake the gate they exist to prove.

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

// Fixture repos do real git + adlc work; the same generous hang-guard the other heavy suites carry.
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

// On CI the skip would FAIL OPEN: a runner that lost its adlc provisioning would report the
// trust-root gate suite green without running one test of it, which is H9 wearing a test
// convenience. Locally a loud skip is a kindness; on CI it is a lie, so CI throws instead.
if (process.env.CI !== undefined && !hasAdlc) {
  throw new Error(
    "the adlc CLI is not on PATH and this is a CI run — the rails-guard-ci suite must fail " +
      "closed rather than skip: provision @adlc/cli in the test job.",
  );
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots)
    rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// One fixture repository: a base commit on `main` carrying the given ticket shards and files, and a
// feature branch carrying the given edits. Returns the repo root.
function fixture(opts: {
  baseTickets?: Record<string, object>; // shard name -> ticket JSON, in .adlc/tickets/
  baseArchive?: Record<string, object>; // shard name -> ticket JSON, in .adlc/ticket-archive/
  baseFiles?: Record<string, string>;
  branchTickets?: Record<string, object>; // added on the branch (first-declaration)
  branchEdits?: Record<string, string>;
}): string {
  const root = mkdtempSync(join(tmpdir(), "loam-t69-fixture-"));
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
  for (const [name, t] of Object.entries(opts.baseArchive ?? {})) {
    write(`.adlc/ticket-archive/${name}`, JSON.stringify(t, null, 2));
  }
  for (const [rel, content] of Object.entries(opts.baseFiles ?? {})) write(rel, content);
  git("add", "-A");
  git("commit", "-m", "base");
  git("checkout", "-b", "feature");
  for (const [name, t] of Object.entries(opts.branchTickets ?? {})) {
    write(`.adlc/tickets/${name}`, JSON.stringify(t, null, 2));
  }
  for (const [rel, content] of Object.entries(opts.branchEdits ?? {})) write(rel, content);
  git("add", "-A");
  git("commit", "-m", "feature work");
  return root;
}

// Run the wrapper exactly as CI does and report its exit code and combined output.
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

describe.skipIf(!hasAdlc)("rails-guard-ci: the freeze survives the ticket's landing", () => {
  it("RED: a branch edits a rail declared by an ARCHIVED (landed) ticket", () => {
    // The case that was silently green for the gate's whole life: P6 archives the realized
    // ticket, and a rail nobody still lists in tickets/ is exactly the rail guarding a bug the
    // repo already paid for.
    const root = fixture({
      baseArchive: { "t1--aaaa.json": ticket("T1", ["test/foo.test.ts"]) },
      baseFiles: { "test/foo.test.ts": "expect(true).toBe(true) // the rail\n" },
      branchEdits: { "test/foo.test.ts": "expect(true).toBe(true) // weakened\n" },
    });
    const { code, out } = runGate(root);
    expect(out).toContain("guarding 1 frozen rail(s)");
    expect(code).toBe(2);
  });

  it("RED: a live ticket's rail is equally frozen (the base mechanism, unregressed)", () => {
    const root = fixture({
      baseTickets: { "t2--bbbb.json": ticket("T2", ["test/foo.test.ts"]) },
      baseFiles: { "test/foo.test.ts": "expect(true).toBe(true)\n" },
      branchEdits: { "test/foo.test.ts": "expect(false).toBe(false)\n" },
    });
    expect(runGate(root).code).toBe(2);
  });

  it("GREEN: a branch FIRST-DECLARING a rail inside a pre-existing suite passes its own gate", () => {
    // T67's exact shape: the suite exists on the base, no base ticket declares it, and the branch
    // both declares and extends it. Failing this is the every-ticket bypass the wrapper exists to
    // prevent — it would teach everyone to reach for ADLC_RAILS_BYPASS as routine.
    const root = fixture({
      baseFiles: { "test/existing.test.ts": "expect(1).toBe(1)\n" },
      branchTickets: { "t3--cccc.json": ticket("T3", ["test/existing.test.ts"]) },
      branchEdits: {
        "test/existing.test.ts": "expect(1).toBe(1)\nexpect(2).toBe(2) // new rail\n",
      },
    });
    expect(runGate(root).code).toBe(0);
  });

  it("GREEN: a branch cannot un-archive its way out — deleting the archived shard changes nothing", () => {
    // The working store is never consulted, so removing the declaration on the branch leaves the
    // base's freeze intact. (The same property that already held for tickets/ under-declaration.)
    const root = fixture({
      baseArchive: { "t4--dddd.json": ticket("T4", ["test/foo.test.ts"]) },
      baseFiles: { "test/foo.test.ts": "expect(true).toBe(true)\n" },
      branchEdits: {
        "test/foo.test.ts": "expect(true).toBe(true) // edited\n",
        ".adlc/ticket-archive/t4--dddd.json": JSON.stringify(ticket("T4", []), null, 2),
      },
    });
    expect(runGate(root).code).toBe(2);
  });

  it("GREEN: untouched rails pass, and an empty store says so honestly", () => {
    const clean = fixture({
      baseArchive: { "t5--eeee.json": ticket("T5", ["test/foo.test.ts"]) },
      baseFiles: {
        "test/foo.test.ts": "expect(true).toBe(true)\n",
        "src/other.ts": "export {};\n",
      },
      branchEdits: { "src/other.ts": "export const x = 1;\n" },
    });
    expect(runGate(clean).code).toBe(0);

    const empty = fixture({
      baseFiles: { "src/other.ts": "export {};\n" },
      branchEdits: { "src/other.ts": "export const x = 1;\n" },
    });
    const { code, out } = runGate(empty);
    expect(code).toBe(0);
    expect(out).toContain("nothing is frozen yet");
  });

  it("a `**` glob freezes the whole subtree it names — the glob path is exercised, not assumed", () => {
    // The wrapper's only non-literal glob support. Left untested, hollow-test showed its regex
    // translation could be corrupted with every fixture still green, because every other case
    // uses literal paths.
    const root = fixture({
      baseArchive: { "t6--ffff.json": ticket("T6", ["test/deep/**"]) },
      baseFiles: { "test/deep/nested/foo.test.ts": "expect(true).toBe(true)\n" },
      branchEdits: { "test/deep/nested/foo.test.ts": "expect(true).toBe(true) // edited\n" },
    });
    expect(runGate(root).code).toBe(2);
  });

  it("a mid-path `**` matches ZERO directories too — `test/**/pin.test.ts` freezes `test/pin.test.ts`", () => {
    // The collapse of `[^\0]*/` into `(?:.*/)?` is what makes the intermediate segment optional.
    // hollow-test corrupted that replace with every other fixture green; under the mutant this
    // rail reads as unborn (the file stops matching the glob) and the edit sails through.
    const root = fixture({
      baseArchive: { "t8--1111.json": ticket("T8", ["test/**/pin.test.ts"]) },
      baseFiles: { "test/pin.test.ts": "expect(true).toBe(true)\n" },
      branchEdits: { "test/pin.test.ts": "expect(true).toBe(true) // edited\n" },
    });
    expect(runGate(root).code).toBe(2);
  });

  it("GREEN: a declared rail whose file is not on the base yet is unborn, and unborn is exit 0", () => {
    // The pre-declared-ticket case. If this exits non-zero, every PR fails CI from the moment any
    // ticket declares a rail it has not yet written — the gate would train everyone to bypass it.
    const root = fixture({
      baseTickets: { "t7--0000.json": ticket("T7", ["test/not-written-yet.test.ts"]) },
      baseFiles: { "src/other.ts": "export {};\n" },
      branchEdits: { "src/other.ts": "export const x = 1;\n" },
    });
    const { code, out } = runGate(root);
    expect(code).toBe(0);
    expect(out).toContain("nothing to protect");
  });

  it("an unreadable base is an OPERATIONAL error (exit 1), never a rail verdict (exit 2)", () => {
    // CI treats exit 2 as "a frozen rail was edited" and blames the PR. A gate that cannot even
    // read its base has no verdict to give, and must say so in the operational lane.
    const root = fixture({
      baseFiles: { "src/other.ts": "export {};\n" },
      branchEdits: { "src/other.ts": "export const x = 1;\n" },
    });
    try {
      execFileSync("node", [WRAPPER, "no-such-ref"], { cwd: root, encoding: "utf8" });
      expect.unreachable("the gate accepted a base ref that does not exist");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(1);
    }
  });
});

describe.skipIf(hasAdlc)("rails-guard-ci fixture suite", () => {
  it("SKIPPED: the adlc CLI is not installed, and this suite refuses to fake the gate it proves", () => {
    expect(hasAdlc).toBe(false);
  });
});
