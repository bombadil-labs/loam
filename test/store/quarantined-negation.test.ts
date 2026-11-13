import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { admit, negatesOf, strandedStrikeWarnings } from "../../src/store/quarantine.js";

const SEED = "0e".repeat(32);
const OP = authorForSeed(SEED);
const TARGET = "1e".repeat(32);

const tmp = mkdtempSync(join(tmpdir(), "loam-t57-"));
let n = 0;
const freshPath = () => join(tmp, `s-${n++}.sqlite`);

describe("§25/H1 — a quarantined negation names the strike it stranded", () => {
  it("DELTA LEVEL: a corrupt-signature negation is quarantined carrying its target id", async () => {
    const path = freshPath();
    const store = new SqliteBackend(path);
    const negation = signClaims(makeNegationClaims(OP, 1000, TARGET, "retracted"), SEED);
    await store.append([negation]);
    await store.close();

    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), negation.id);
    db.close();

    const store2 = new SqliteBackend(path);
    await store2.deltasSince(new Set());
    const rows = await store2.quarantine();
    const row = rows.find((r) => r.key === negation.id);
    expect(row).toBeDefined();
    expect(row!.reason).toBe("invalid-signature");
    expect(row!.negates).toEqual([TARGET]);
    await store2.close();
    rmSync(path, { force: true });
  });

  it("OBJECT LEVEL: the operator warning names the stranded target, and cautions on the opaque case", () => {
    const named = strandedStrikeWarnings([
      { key: "k1", reason: "invalid-signature", preview: "…", negates: [TARGET] },
    ]);
    expect(named.join(" ")).toContain(TARGET);
    expect(named.join(" ")).toMatch(/live|strike|retract|until settled/i);

    const opaque = strandedStrikeWarnings([{ key: "k2", reason: "unparseable", preview: "…" }]);
    expect(opaque.length).toBeGreaterThan(0);
    expect(opaque.join(" ")).toMatch(/strike|retract|missing/i);

    const benign = strandedStrikeWarnings([
      { key: "k3", reason: "invalid-signature", preview: "…" },
    ]);
    expect(benign).toEqual([]);
  });

  it("negatesOf extracts EVERY negates pointer, not just the first (the substrate honors all)", () => {
    const T2 = "2e".repeat(32);
    const claims = {
      timestamp: 1,
      validFrom: 1,
      author: OP,
      pointers: [
        {
          role: "negates" as const,
          target: { kind: "delta" as const, deltaRef: { delta: TARGET } },
        },
        { role: "negates" as const, target: { kind: "delta" as const, deltaRef: { delta: T2 } } },
      ],
    };
    expect(negatesOf(claims)).toEqual([TARGET, T2]);
  });

  it("a MULTI-TARGET negation (a foreign delta striking several ids) discloses EVERY stranded strike", () => {
    const T2 = "2e".repeat(32);
    const warnings = strandedStrikeWarnings([
      { key: "k", reason: "invalid-signature", preview: "…", negates: [TARGET, T2] },
    ]);
    expect(warnings.join(" ")).toContain(TARGET);
    expect(warnings.join(" ")).toContain(T2);
    expect(warnings.length).toBe(2);
  });

  it("admit surfaces the negation target on a parsed-claims failure", () => {
    const negation = signClaims(makeNegationClaims(OP, 1000, TARGET, "retracted"), SEED);
    const verdict = admit("wrong-id", "wrong-id", negation.claims, negation.sig, {
      parseClaims: (r) => r as (typeof negation)["claims"],
      computeId: () => negation.id,
      makeDelta: (c, s) => ({ id: negation.id, claims: c, sig: s! }),
      verifyDelta: () => "verified",
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.negates).toEqual([TARGET]);
  });
});
