// Slate and graveyard records declare `loam:slate`. A store whose journal holds a record in the
// retired format (declared at `loam:erasure`) is refused at boot, before any read is served: no
// reader honors that record, so serving the store would reopen every door it closed. The door
// refuses a new record in that format too. Loam does not migrate it.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signClaims, type Delta } from "@bombadil/rhizomatic";
import { Gateway } from "../../src/gateway/gateway.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { admitLocal } from "../../src/gateway/peer-admission.js";
import { CTX_GRAVEYARD } from "../../src/gateway/slate-law.js";
import { CTX_SLATE } from "../../src/gateway/slate-vocab.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { OP, OP_SEED } from "./slating.js";
import { FERN } from "../spike/garden.js";

const retired = (context: string): Delta =>
  signClaims(
    {
      author: OP,
      timestamp: 50_000,
      validFrom: 50_000,
      pointers: [
        { role: "declares", target: { kind: "entity", entity: { id: "loam:erasure", context } } },
        { role: "slate", target: { kind: "entity", entity: { id: FERN, context: "slated" } } },
      ],
    },
    OP_SEED,
  );

async function durable(path: string): Promise<{ backend: SqliteBackend; gw: Gateway }> {
  const backend = new SqliteBackend(path);
  const gw = await Gateway.boot(backend, assembleGenesis({ operatorSeed: OP_SEED }), {
    peerStore: backend.journalStore(),
  });
  return { backend, gw };
}

describe("a slate record in the retired format", () => {
  for (const [kind, context] of [
    ["slate", CTX_SLATE],
    ["graveyard", CTX_GRAVEYARD],
  ] as const) {
    it(`a journal holding a retired ${kind} record is refused at boot`, async () => {
      const path = join(mkdtempSync(join(tmpdir(), "loam-slate-retired-")), "s.sqlite");
      const first = await durable(path);
      // The earlier format reached the journal through its own door. Admit it below today's door.
      await admitLocal(first.gw.peer!, [retired(context)], first.gw.now(), () => false);
      await first.gw.close();
      await first.backend.close();

      const backend = new SqliteBackend(path);
      await expect(
        Gateway.boot(backend, assembleGenesis({ operatorSeed: OP_SEED }), {
          peerStore: backend.journalStore(),
        }),
      ).rejects.toThrow(/slate format: .*retired format.*does not migrate/);
      await backend.close();
    });

    it(`the door refuses a new retired ${kind} record`, async () => {
      const path = join(mkdtempSync(join(tmpdir(), "loam-slate-retired-")), "s.sqlite");
      const { backend, gw } = await durable(path);
      await expect(gw.append([retired(context)])).rejects.toThrow(/its retired format/);
      await gw.close();
      await backend.close();
    });
  }

  it("a store with no retired record boots", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "loam-slate-retired-")), "s.sqlite");
    const first = await durable(path);
    await first.gw.close();
    await first.backend.close();
    const second = await durable(path);
    expect(second.gw.peer).toBeDefined();
    await second.gw.close();
    await second.backend.close();
  });
});
