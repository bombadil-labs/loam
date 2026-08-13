// THE "REPAIRED" REPORT SAYS EVERYTHING THE RUN DID — §23.3 pens, hazard H7 at the CLI layer.
//
// `loam pen create` has three outcomes, and two of them can strike a previous key's standing:
// re-key (seed file gone) and REPAIR (seed file present, its author without a grant). The repair
// arm reaches the same stale-record loop — a hand-replaced seed file leaves the OLD author's pen
// record and grants in the ground, and the run strikes them all — but its report used to name only
// the grant it added. A run that revokes a key must say so whichever arm it took; a report that is
// true and materially incomplete about a revocation is H7's shape.
//
// Two-sided on purpose: the strike line appears when a key was struck, and does NOT appear on the
// ordinary grant-only repair — a fix that sprayed revocation text over every repair would trade an
// incomplete report for a false one. (T102's frozen rail, test/cli/pen.test.ts, pins the grant-only
// arm's opening line; this file owns the hand-replaced-seed state it never stages.)

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { penSeedPath, writePenSeed } from "../../src/cli/config.js";

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-pen-report-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("loam pen create — the repaired arm's report", () => {
  it("a repair that struck a previous key SAYS it struck the key", async () => {
    await run(["init", "--home", home], io());
    await run(["pen", "create", "guest-pen", "--home", home], io());
    const oldAuthor = authorForSeed(readFileSync(penSeedPath(home, "guest-pen"), "utf8").trim());

    // The state the frozen rail never stages: the file is hand-replaced with a fresh key while
    // the ground still holds the old author's record and grant. The new file's author has no
    // standing, so the run takes the REPAIRED arm — and the stale-record loop strikes the old key.
    const replacement = "7a".repeat(32);
    writePenSeed(home, "guest-pen", replacement);
    out.length = 0;

    const code = await run(["pen", "create", "guest-pen", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("repaired pen guest-pen");
    // The report names the struck key and the count, same voice as the re-keyed arm.
    expect(printed).toContain(`the previous key ${oldAuthor} is struck`);
    expect(printed).not.toContain(replacement); // the secret still never prints
  });

  it("a grant-only repair does NOT claim a strike it never made", async () => {
    await run(["init", "--home", home], io());
    // Custody present, authorization missing, and NO prior record to strike.
    writePenSeed(home, "hand-pen", "5c".repeat(32));
    out.length = 0;

    const code = await run(["pen", "create", "hand-pen", "--home", home], io());
    expect(code).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("repaired pen hand-pen");
    expect(printed).toContain("write grant for its author");
    expect(printed).not.toContain("previous key");
    expect(printed).not.toContain("struck");
  });
});

describe("loam register --help — the shelf's federation warning", () => {
  it("distinguishes the latest-wins props from the append-all lists", async () => {
    const code = await run(["register", "--help"], io());
    expect(code).toBe(0);
    const printed = [...out, ...err].join("\n");
    // The old sentence generalized latest-wins over every prop; tags, attending and follows are
    // `all` policies a later claim cannot displace. The help must name both behaviours.
    expect(printed).toContain("Single-value props are latest-wins");
    expect(printed).toContain("tags, attending, follows");
    expect(printed).not.toMatch(/Props are latest-wins/);
  });
});
