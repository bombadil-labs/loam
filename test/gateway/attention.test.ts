// SPEC §49 criteria (b) and (d) — the since-last-looked reading and quiet-as-a-reading (T212;
// the working spec at .adlc/specs/49-legibility.md, settled 2026-08-28). Both levels per the
// house rule: what is in the DELTAS (one standing looked-row per (user, container), superseded
// in place; a quiet mark that moves no bytes) and what a READER resolves (the summary's counts
// by consequence class and author; a quiet container absent from the default surface and whole
// underneath).
//
// STATED, NOT ASSERTED: the reading accepts looked-records from an EXPLICIT author set, because
// the ground holds no canonical user↔key binding (that is T137's arc). The caller names the
// keys that speak for the user; the two-keys case below proves the reading shares one moment
// across them. And `claims.timestamp` is the author's clock — a federated peer's backdated
// claim can hide beneath a looked-moment. The rail that would close that reads arrival
// attestations (loam.arrival) instead; it belongs to the follow-on that indexes arrival order,
// not to this file.

import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { describe, expect, it } from "vitest";
import { grantClaims } from "../../src/gateway/accounts.js";
import {
  CTX_LOOKED,
  CTX_QUIET,
  attentionSummaryImpl,
  lookedClaims,
  quietClaims,
  quietContainersImpl,
} from "../../src/gateway/attention.js";
import { containerClaims } from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "0a".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const ADA_SECOND_SEED = "0b".repeat(32); // ada after a recovery: a new key, the same person
const ADA_SECOND = authorForSeed(ADA_SECOND_SEED);
const RAE_SEED = "0c".repeat(32);
const RAE = authorForSeed(RAE_SEED);

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

/** A governed store with one shared container ada writes into, and rae as a second reader. */
async function store(): Promise<{ gw: Gateway; ts: () => number }> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  let t = 1000;
  const ts = () => ++t;
  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, ADA, "write", OPERATOR, ts()), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, ADA_SECOND, "write", OPERATOR, ts()), OPERATOR_SEED),
    signClaims(grantClaims(STORE_ENTITY, RAE, "write", OPERATOR, ts()), OPERATOR_SEED),
    signClaims(
      containerClaims(
        { container: "garden", trust: "curated", posture: "shared", membership: authoredBy(ADA) },
        OPERATOR,
        ts(),
      ),
      OPERATOR_SEED,
    ),
  ]);
  return { gw, ts };
}

/** One ordinary data claim by ada into the garden's membership (authored-by term). */
const dataClaim = (t: number) =>
  signClaims(
    {
      timestamp: t,
      author: ADA,
      pointers: [
        { role: "notes", target: { kind: "entity", entity: { id: "note:day", context: "diary" } } },
        { role: "text", target: { kind: "primitive", value: `entry at ${t}` } },
      ],
    } as never,
    ADA_SEED,
  );

describe("§49(b) — the looked-record: one standing row, superseded in place", () => {
  it("a second look supersedes the first at the deltas AND at the reading; nothing is negated", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 5000, ADA, ts()), ADA_SEED)]);
    await gw.append([signClaims(lookedClaims("ada", "garden", 7000, ADA, ts()), ADA_SEED)]);

    // Delta level: BOTH rows are in the ground (supersede-in-place is append + latest-wins,
    // never a strike), keyed by the one composite entity.
    const rows = [...gw.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_LOOKED,
      ),
    );
    expect(rows.length).toBe(2);
    for (const d of rows) expect(gw.reactor.negationsOf(d.id)).toEqual([]);

    // Object level: the reading resolves ONE moment, the later one.
    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(summary.get("garden")?.lookedAt).toBe(7000);
  });

  it("two keys of ONE user share one looked-moment; a second user's looks do not disturb the first's", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 5000, ADA, ts()), ADA_SEED)]);
    // ada's recovered key writes the next look — same user name, different author.
    await gw.append([
      signClaims(lookedClaims("ada", "garden", 8000, ADA_SECOND, ts()), ADA_SECOND_SEED),
    ]);
    // rae looks much later; her row must not touch ada's.
    await gw.append([signClaims(lookedClaims("rae", "garden", 9000, RAE, ts()), RAE_SEED)]);

    const ada = attentionSummaryImpl(gw, "ada", new Set([ADA, ADA_SECOND]));
    expect(ada.get("garden")?.lookedAt).toBe(8000);
    const rae = attentionSummaryImpl(gw, "rae", new Set([RAE]));
    expect(rae.get("garden")?.lookedAt).toBe(9000);
  });

  it("an author outside the accepted set cannot move a user's looked-moment", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 5000, ADA, ts()), ADA_SEED)]);
    // rae writes a record CLAIMING ada looked later — well-formed, granted, and not ada's key.
    await gw.append([signClaims(lookedClaims("ada", "garden", 9999, RAE, ts()), RAE_SEED)]);
    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(summary.get("garden")?.lookedAt).toBe(5000);
  });
});

describe("§49(b) — the summary: counted by consequence class and author, never listed", () => {
  it("claims since the looked-moment group by class (data/law/trust/erasure) and by author", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 2000, ADA, ts()), ADA_SEED)]);

    // Since 2000: two data claims by ada land in the garden.
    await gw.append([dataClaim(3000)]);
    await gw.append([dataClaim(3100)]);

    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    const garden = summary.get("garden");
    expect(garden).toBeDefined();
    expect(garden!.total).toBe(2);
    expect(garden!.byClass.data).toBe(2);
    expect(garden!.byClass.law).toBe(0);
    expect(garden!.byClass.trust).toBe(0);
    expect(garden!.byClass.erasure).toBe(0);
    expect(garden!.byAuthor.get(ADA)).toBe(2);
    // Counted, not listed: the summary carries no delta ids and no claim bodies.
    expect(JSON.stringify([...summary])).not.toContain("entry at");
  });

  it("claims at or before the looked-moment do not count; with no look, everything counts", async () => {
    const { gw, ts } = await store();
    await gw.append([dataClaim(3000)]);
    const before = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(before.get("garden")?.lookedAt).toBe(0);
    expect(before.get("garden")?.total).toBe(1);

    await gw.append([signClaims(lookedClaims("ada", "garden", 3000, ADA, ts()), ADA_SEED)]);
    const after = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(after.get("garden")?.total).toBe(0);
  });
});

describe("§49(d) — quiet is a READING preference, never a storage state", () => {
  it("marking quiet changes no door's answer and moves no bytes; unmarking restores the surface", async () => {
    const { gw, ts } = await store();
    await gw.append([dataClaim(3000)]);

    const memberIdsBefore = gw
      .containerScope({ containers: ["garden"] })
      .map((d) => d.id)
      .sort();
    const sizeBefore = gw.reactor.size;

    await gw.append([signClaims(quietClaims("garden", true, OPERATOR, ts()), OPERATOR_SEED)]);
    expect(quietContainersImpl(gw).has("garden")).toBe(true);
    // The default attention surface omits it...
    const surfaced = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(surfaced.has("garden")).toBe(false);
    // ...and asking past the preference still answers whole.
    const asked = attentionSummaryImpl(gw, "ada", new Set([ADA]), { includeQuiet: true });
    expect(asked.get("garden")?.total).toBe(1);

    // NOTHING moved: the container's members answer identically through the ordinary door,
    // and no delta left the ground (the quiet mark itself is the only addition).
    const memberIdsAfter = gw
      .containerScope({ containers: ["garden"] })
      .map((d) => d.id)
      .sort();
    expect(memberIdsAfter).toEqual(memberIdsBefore);
    expect(gw.reactor.size).toBe(sizeBefore + 1);

    // Two-sided: unmarking restores the default surface.
    await gw.append([signClaims(quietClaims("garden", false, OPERATOR, ts()), OPERATOR_SEED)]);
    expect(quietContainersImpl(gw).has("garden")).toBe(false);
    const restored = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(restored.has("garden")).toBe(true);
  });

  it("a container whose members cannot be read is an honest row, not a dead summary", async () => {
    const { gw, ts } = await store();
    await gw.append([dataClaim(3000)]);
    // A separate-posture container with no attached pool: its scope read refuses (H9), and the
    // summary must carry that refusal as a row while the readable sibling stays whole.
    await gw.append([
      signClaims(
        containerClaims(
          { container: "vault", trust: "curated", posture: "separate" },
          OPERATOR,
          ts(),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(summary.get("vault")?.unreadable, "the refusal is not carried").toBeDefined();
    expect(summary.get("vault")?.total).toBe(0);
    expect(summary.get("garden")?.total).toBe(1);
    expect(summary.get("garden")?.unreadable).toBeUndefined();
  });

  it("a quiet mark is vocabulary, not data: it wears the loam context and only the operator's binds", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(quietClaims("garden", true, RAE, ts()), RAE_SEED)]);
    // A non-operator's quiet-shaped claim is a claim ABOUT the store, not a preference of it.
    expect(quietContainersImpl(gw).has("garden")).toBe(false);
    const rows = [...gw.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_QUIET,
      ),
    );
    expect(rows.length).toBe(1);
  });
});
