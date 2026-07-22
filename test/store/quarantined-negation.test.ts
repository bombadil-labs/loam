// §25 row quarantine meets §11/H1 — a quarantined row that is a NEGATION silently revives its
// target, and the operator is never told (ticket T57, the DISCLOSURE half; recovery is T66).
//
// `deltasSince` sets aside a row that fails admission and reads on. That is a narrowing of the
// delta-set, and the one narrowing that cannot carry a negation closure — the dropped row is
// precisely what is illegible. A missing CLAIM contributes nothing; a missing NEGATION revives its
// target (a retracted value, a revoked grant, a tombstone). Two of the three quarantine reasons
// (id-mismatch, invalid-signature) have already PARSED the claims, so the driver can see the row
// carries a `negates` ref and name the target — turning a silent revival into a loud one the
// operator can act on (repair discard + re-federate today; automatic recovery under T66).

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { admit, strandedStrikeWarnings } from "../../src/store/quarantine.js";

const SEED = "0e".repeat(32);
const OP = authorForSeed(SEED);
const TARGET = "1e".repeat(32); // the delta the negation strikes

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

    // Corrupt the negation's signature — claims still parse, so the driver can read its `negates`.
    const db = new Database(path);
    db.prepare("UPDATE deltas SET sig = ? WHERE id = ?").run("ab".repeat(64), negation.id);
    db.close();

    const store2 = new SqliteBackend(path);
    await store2.deltasSince(new Set()); // triggers admission + quarantine
    const rows = await store2.quarantine();
    const row = rows.find((r) => r.key === negation.id);
    expect(row).toBeDefined();
    expect(row!.reason).toBe("invalid-signature");
    // The stranded strike must be named, or the revival is silent.
    expect(row!.negates).toEqual([TARGET]);
    await store2.close();
    rmSync(path, { force: true });
  });

  it("OBJECT LEVEL: the operator warning names the stranded target, and cautions on the opaque case", () => {
    // A parsed-claims quarantine (invalid-signature / id-mismatch) names its target.
    const named = strandedStrikeWarnings([
      { key: "k1", reason: "invalid-signature", preview: "…", negates: [TARGET] },
    ]);
    expect(named.join(" ")).toContain(TARGET);
    expect(named.join(" ")).toMatch(/live|strike|retract|until settled/i);

    // An unparseable row cannot name a target, but the operator must still be cautioned that a
    // strike MAY be missing rather than told nothing.
    const opaque = strandedStrikeWarnings([{ key: "k2", reason: "unparseable", preview: "…" }]);
    expect(opaque.length).toBeGreaterThan(0);
    expect(opaque.join(" ")).toMatch(/strike|retract|missing/i);

    // A quarantined row that is NOT a negation strands nothing — no false alarm.
    const benign = strandedStrikeWarnings([
      { key: "k3", reason: "invalid-signature", preview: "…" },
    ]);
    expect(benign).toEqual([]);
  });

  it("a MULTI-TARGET negation (a foreign delta striking several ids) discloses EVERY stranded strike", () => {
    // The substrate honors every `negates` pointer, so one delta can strike several targets — a
    // peer can revoke several grants at once. If only the first were disclosed, the rest revive
    // silently, which is the exact H1 escape the disclosure exists to close.
    const T2 = "2e".repeat(32);
    const warnings = strandedStrikeWarnings([
      { key: "k", reason: "invalid-signature", preview: "…", negates: [TARGET, T2] },
    ]);
    expect(warnings.join(" ")).toContain(TARGET);
    expect(warnings.join(" ")).toContain(T2);
    expect(warnings.length).toBe(2); // one line per struck id
  });

  it("admit surfaces the negation target on a parsed-claims failure", () => {
    const negation = signClaims(makeNegationClaims(OP, 1000, TARGET, "retracted"), SEED);
    // A negation filed under the WRONG id (id-mismatch): claims parse, so `negates` is available.
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
