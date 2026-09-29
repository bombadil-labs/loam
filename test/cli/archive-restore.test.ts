// A lost primary is restored from its archive through a new peer journal (`loam serve --archive`).
// The restore never admits an id the door refuses forever: the target of an erasure that ever
// bound stays out even when that erasure was later negated. Both levels: the store's bytes and
// journal, and what a reopened gateway serves. A bystander proves the restore still runs.

import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  OrdinaryJournalPeer,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
import { restoreIntoJournal } from "../../src/cli/cli.js";
import { eraseClaims, neverReturns } from "../../src/gateway/erase.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { ArchiveBackend } from "../../src/store/archive.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FaultableBackend } from "../helpers/faultable-backend.js";

const SEED = "3d".repeat(32);
const OP = authorForSeed(SEED);
const note = (n: number): Delta =>
  signClaims(
    {
      timestamp: 20_000 + n,
      validFrom: 20_000 + n,
      author: OP,
      pointers: [
        {
          role: "note",
          target: { kind: "entity", entity: { id: "restore:subject", context: "note" } },
        },
        { role: "n", target: { kind: "primitive", value: n } },
      ],
    },
    SEED,
  );

describe("the archive restore", () => {
  it("keeps a negated erasure's target out, and restores the bystander", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-archive-restore-"));
    const target = note(1);
    const bystander = note(2);
    const order = signClaims(eraseClaims(target.id, OP, OP, 30_000), SEED);
    const unErase = signClaims(makeNegationClaims(OP, 30_001, order.id), SEED);
    const archive = new ArchiveBackend(join(dir, "vault"));
    await archive.append([target, bystander, order, unErase]);
    const primary = new SqliteBackend(join(dir, "store.sqlite"));

    const rows = await archive.deltasSince(new Set());
    const restored = await restoreIntoJournal(
      primary,
      archive,
      neverReturns(rows, 40_000, OP),
      SEED,
    );
    expect(restored).toBe(3);
    // delta level: the target is neither held nor admitted; the rest are admitted
    expect(await primary.holds(target.id)).toBe(false);
    const opened = await OrdinaryJournalPeer.open(primary.journalStore(), OP);
    if (opened.status !== "open") throw new Error(opened.status);
    const admitted = opened.peer.snapshot().base.admitted;
    expect(admitted.has(target.id)).toBe(false);
    for (const d of [bystander, order, unErase]) expect(admitted.has(d.id)).toBe(true);
    // object level: a reopened gateway serves the bystander and never the target
    const gw = await Gateway.open(primary, { seed: SEED });
    expect(gw.reactor.get(bystander.id)).toBeDefined();
    expect(gw.reactor.get(target.id)).toBeUndefined();
    await gw.close();
    await archive.close();
  });

  it("a restore a fault interrupts is resumed by the next run, never served half done", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-archive-restore-"));
    const rows = [note(3), note(4), note(5)];
    const archive = new ArchiveBackend(join(dir, "vault"));
    await archive.append(rows);
    let writes = 0;
    class Flaky extends FaultableBackend {
      // eslint-disable-next-line @typescript-eslint/require-await
      override async checkWrite(batch: readonly Delta[]): Promise<void> {
        if (batch.length > 0 && ++writes === 2) throw new Error("the disk hiccupped");
      }
    }
    const primary = new Flaky();
    const marker = join(dir, "store.restoring");
    const dead = new Set<string>();
    await expect(restoreIntoJournal(primary, archive, dead, SEED, marker)).rejects.toThrow(
      /hiccupped/,
    );
    expect(existsSync(marker)).toBe(true); // the store holds a partial restore, and says so
    expect(await restoreIntoJournal(primary, archive, dead, SEED, marker)).toBe(2);
    expect(existsSync(marker)).toBe(false);
    const gw = await Gateway.open(primary, { seed: SEED });
    for (const d of rows) expect(gw.reactor.get(d.id)).toBeDefined();
    await gw.close();
    await archive.close();
  });

  it("an erasure-shaped delta the operator did not sign is testimony: its target is restored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "loam-archive-restore-"));
    const STRANGER = "4e".repeat(32);
    const target = note(6);
    const forged = signClaims(
      eraseClaims(target.id, OP, authorForSeed(STRANGER), 30_000),
      STRANGER,
    );
    const archive = new ArchiveBackend(join(dir, "vault"));
    await archive.append([target, forged]);
    const primary = new SqliteBackend(join(dir, "store.sqlite"));
    const rows = await archive.deltasSince(new Set());
    await restoreIntoJournal(primary, archive, neverReturns(rows, 40_000, OP), SEED);
    const gw = await Gateway.open(primary, { seed: SEED });
    expect(gw.reactor.get(target.id)).toBeDefined();
    expect(await primary.holds(target.id)).toBe(true);
    await gw.close();
    await archive.close();
  });
});
