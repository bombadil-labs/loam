// The rename exemption's own rails. `rails-guard-ci.mjs` gained exactly one exemption — an
// authorized vocabulary rename, declared in `scripts/rail-renames.json` and read FROM THE BASE
// TREE — and the assertion that carries the whole security model is the second test here: a branch
// that declares its own exemption changes nothing. If that one ever goes green with the gate
// refusing nothing, the freeze has a self-service door and every other test in this file is
// decoration.
//
// These fixtures exercise the RAW byte-identity compare only. The prettier-formatted compare
// (a rename that rewraps lines) is deliberately not driven here: a fixture repo carries no
// prettier config, so a formatted compare in a fixture would prove default-config behavior the
// real repo never runs. Its failure direction is closed by construction — an exemption that
// cannot be established leaves the edit a VIOLATION — and the real-repo case is proven by the
// rename PR this mechanism was built for.
//
// Same provisioning contract as the frozen suite beside this file: the wrapper execs the real
// `adlc` CLI, so absence is a loud local skip and a CI failure, never a silent green.

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
    "the adlc CLI is not on PATH and this is a CI run — the rail-renames suite must fail " +
      "closed rather than skip: provision @adlc/cli in the test job.",
  );
}

const roots: string[] = [];
afterAll(() => {
  for (const r of roots)
    rmSync(r, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const TICKET = {
  id: "T1",
  title: "a ticket that froze one rail",
  status: "done",
  phase: "P6",
  edges: [],
  scope: [],
  rails: ["test/frozen.test.ts"],
  body: "fixture",
};

/** The rail as the base froze it. The word `olddoor` is what the renames below retire. */
const RAIL_BASE = [
  "// a frozen rail quoting a vocabulary word",
  'import { it, expect } from "vitest";',
  'it("the door refuses olddoor", () => {',
  '  expect(refusal()).toContain("olddoor");',
  "});",
  "",
].join("\n");

/** Exactly RAIL_BASE with `olddoor` → `newdoor` — the shape an authorized rename produces. */
const RAIL_RENAMED = RAIL_BASE.split("olddoor").join("newdoor");

function fixture(opts: {
  baseRenames?: object; // scripts/rail-renames.json on the BASE
  branchRenames?: object; // ...or written only on the BRANCH (the self-authorization probe)
  branchRail: string; // the frozen rail's content on the branch
}): string {
  const root = mkdtempSync(join(tmpdir(), "loam-rail-renames-"));
  roots.push(root);
  const g = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
  g("init", "-q", "-b", "main");
  g("config", "user.email", "fixture@test");
  g("config", "user.name", "fixture");

  mkdirSync(join(root, ".adlc", "tickets"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, ".adlc", "tickets", "t1--fixture.json"), JSON.stringify(TICKET));
  writeFileSync(join(root, "test", "frozen.test.ts"), RAIL_BASE);
  if (opts.baseRenames)
    writeFileSync(join(root, "scripts", "rail-renames.json"), JSON.stringify(opts.baseRenames));
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  g("branch", "-M", "main");

  g("checkout", "-q", "-b", "feature");
  writeFileSync(join(root, "test", "frozen.test.ts"), opts.branchRail);
  if (opts.branchRenames)
    writeFileSync(join(root, "scripts", "rail-renames.json"), JSON.stringify(opts.branchRenames));
  g("add", "-A");
  g("commit", "-q", "-m", "edit");
  return root;
}

function gate(root: string): { status: number; out: string } {
  try {
    const out = execFileSync("node", [WRAPPER, "main"], { cwd: root, encoding: "utf8" });
    return { status: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const AUTHORIZED = {
  renames: [{ from: "olddoor", to: "newdoor", authorized: "fixture human, 2026-07-26" }],
};

describe.skipIf(!hasAdlc)("the rename exemption", () => {
  it("refuses a frozen-rail edit with no declaration at all — the gate is unchanged by default", () => {
    const { status, out } = gate(fixture({ branchRail: RAIL_RENAMED }));
    expect(status).toBe(2);
    expect(out).toContain("frozen.test.ts");
  });

  it("A BRANCH CANNOT SELF-AUTHORIZE: a declaration written on the branch exempts nothing", () => {
    // The load-bearing test. The declaration is real, well-formed, and would exempt this exact
    // edit — but it is on the branch, and the gate reads only the base. If this ever passes with
    // status 0, the freeze has a self-service door.
    const { status } = gate(fixture({ branchRenames: AUTHORIZED, branchRail: RAIL_RENAMED }));
    expect(status).toBe(2);
  });

  it("exempts a rename declared on the base whose edit is exactly base + substitution", () => {
    const { status, out } = gate(fixture({ baseRenames: AUTHORIZED, branchRail: RAIL_RENAMED }));
    expect(status).toBe(0);
    // Loud, named, attributed — an exemption that fires silently would be a hole, not a mechanism.
    expect(out).toContain("EXEMPT (authorized rename) test/frozen.test.ts");
    expect(out).toContain("olddoor → newdoor");
    expect(out).toContain("fixture human, 2026-07-26");
    expect(out).toContain("synthetic base");
  });

  it("refuses an edit that goes ONE LINE beyond the declared substitution", () => {
    const { status } = gate(
      fixture({
        baseRenames: AUTHORIZED,
        branchRail: RAIL_RENAMED + "// and one smuggled line\n",
      }),
    );
    expect(status).toBe(2);
  });

  it("refuses to run at all over a malformed declaration — authorization is never guessed", () => {
    const { status, out } = gate(
      fixture({
        // `from` === `to` — a substitution that authorizes nothing and means someone erred.
        baseRenames: { renames: [{ from: "olddoor", to: "olddoor", authorized: "x" }] },
        branchRail: RAIL_RENAMED,
      }),
    );
    expect(status).toBe(1);
    expect(out).toContain("malformed entry");
  });

  it("an unscoped pair must be word-shaped — a phrase with spaces needs a files scope", () => {
    const { status, out } = gate(
      fixture({
        baseRenames: {
          renames: [{ from: "expect(refusal()).toContain", to: "void", authorized: "x" }],
        },
        branchRail: RAIL_RENAMED,
      }),
    );
    expect(status).toBe(1);
    expect(out).toContain("malformed entry");
  });

  it("a scoped pair exempts only its named files", () => {
    const scoped = {
      renames: [
        {
          from: "olddoor",
          to: "newdoor",
          files: ["test/some-other.test.ts"],
          authorized: "fixture human, 2026-07-26",
        },
      ],
    };
    const { status } = gate(fixture({ baseRenames: scoped, branchRail: RAIL_RENAMED }));
    expect(status).toBe(2);
  });
});
