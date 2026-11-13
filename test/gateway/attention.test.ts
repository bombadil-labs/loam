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
import { containerClaims } from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const ADA_SEED = "0a".repeat(32);
const ADA = authorForSeed(ADA_SEED);
const ADA_SECOND_SEED = "0b".repeat(32);
const ADA_SECOND = authorForSeed(ADA_SECOND_SEED);
const RAE_SEED = "0c".repeat(32);
const RAE = authorForSeed(RAE_SEED);

const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

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

const dataClaim = (t: number) =>
  signClaims(
    {
      timestamp: t,
      validFrom: t,
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

    const rows = [...gw.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_LOOKED,
      ),
    );
    expect(rows.length).toBe(2);
    for (const d of rows) expect(gw.reactor.negationsOf(d.id)).toEqual([]);

    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(summary.get("garden")?.lookedAt).toBe(7000);
  });

  it("two keys of ONE user share one looked-moment; a second user's looks do not disturb the first's", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 5000, ADA, ts()), ADA_SEED)]);
    await gw.append([
      signClaims(lookedClaims("ada", "garden", 8000, ADA_SECOND, ts()), ADA_SECOND_SEED),
    ]);
    await gw.append([signClaims(lookedClaims("rae", "garden", 9000, RAE, ts()), RAE_SEED)]);

    const ada = attentionSummaryImpl(gw, "ada", new Set([ADA, ADA_SECOND]));
    expect(ada.get("garden")?.lookedAt).toBe(8000);
    const rae = attentionSummaryImpl(gw, "rae", new Set([RAE]));
    expect(rae.get("garden")?.lookedAt).toBe(9000);
  });

  it("an author outside the accepted set cannot move a user's looked-moment", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 5000, ADA, ts()), ADA_SEED)]);
    await gw.append([signClaims(lookedClaims("ada", "garden", 9999, RAE, ts()), RAE_SEED)]);
    const summary = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(summary.get("garden")?.lookedAt).toBe(5000);
  });
});

describe("§49(b) — the summary: counted by consequence class and author, never listed", () => {
  it("claims since the looked-moment group by class (data/law/trust/erasure) and by author", async () => {
    const { gw, ts } = await store();
    await gw.append([signClaims(lookedClaims("ada", "garden", 2000, ADA, ts()), ADA_SEED)]);

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
    const surfaced = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(surfaced.has("garden")).toBe(false);
    const asked = attentionSummaryImpl(gw, "ada", new Set([ADA]), { includeQuiet: true });
    expect(asked.get("garden")?.total).toBe(1);

    const memberIdsAfter = gw
      .containerScope({ containers: ["garden"] })
      .map((d) => d.id)
      .sort();
    expect(memberIdsAfter).toEqual(memberIdsBefore);
    expect(gw.reactor.size).toBe(sizeBefore + 1);

    await gw.append([signClaims(quietClaims("garden", false, OPERATOR, ts()), OPERATOR_SEED)]);
    expect(quietContainersImpl(gw).has("garden")).toBe(false);
    const restored = attentionSummaryImpl(gw, "ada", new Set([ADA]));
    expect(restored.has("garden")).toBe(true);
  });

  it("a container whose members cannot be read is an honest row, not a dead summary", async () => {
    const { gw, ts } = await store();
    await gw.append([dataClaim(3000)]);
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
    expect(quietContainersImpl(gw).has("garden")).toBe(false);
    const rows = [...gw.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_QUIET,
      ),
    );
    expect(rows.length).toBe(1);
  });
});
