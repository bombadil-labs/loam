// Per-append and reopen timing for the step 6 host trial: today's path against the journal path.
// Usage: npm run build && node refactor/trial/append-timing.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { Gateway } from "../../dist/gateway/gateway.js";
import { assembleGenesis } from "../../dist/gateway/genesis.js";
import { MemoryBackend } from "../../dist/store/memory.js";
import { SqliteBackend } from "../../dist/store/sqlite.js";

const SEED = "5a".repeat(32);
const OP = authorForSeed(SEED);
let n = 0;
const note = () => {
  n += 1;
  return signClaims(
    {
      timestamp: 1_000_000 + n,
      validFrom: 1_000_000 + n,
      author: OP,
      pointers: [
        {
          role: "note",
          target: { kind: "entity", entity: { id: `t:${n % 97}`, context: "note" } },
        },
        { role: "n", target: { kind: "primitive", value: n } },
      ],
    },
    SEED,
  );
};

const SIZES = [0, 1000, 4000];
const SAMPLES = 40;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const p90 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)];

const rows = [];
for (const driver of ["memory", "sqlite"]) {
  for (const path of ["today", "journal"]) {
    for (const size of SIZES) {
      const backend =
        driver === "memory"
          ? new MemoryBackend()
          : new SqliteBackend(join(mkdtempSync(join(tmpdir(), "loam-timing-")), "s.sqlite"));
      const gw = await Gateway.boot(
        backend,
        assembleGenesis({ operatorSeed: SEED }),
        path === "journal" ? { peerStore: backend.journalStore() } : {},
      );
      for (let done = 0; done < size; done += 200) {
        await gw.append(Array.from({ length: Math.min(200, size - done) }, note));
      }
      const times = [];
      for (let i = 0; i < SAMPLES; i += 1) {
        const d = note();
        const t0 = performance.now();
        await gw.append([d]);
        times.push(performance.now() - t0);
      }
      const held = gw.reactor.size;
      await gw.flush();
      // Reopen: a second gateway over the same stored data, from start to ready.
      const r0 = performance.now();
      const again = await Gateway.boot(
        backend,
        assembleGenesis({ operatorSeed: SEED }),
        path === "journal" ? { peerStore: backend.journalStore() } : {},
      );
      const reopen = performance.now() - r0;
      if (again.reactor.size !== held)
        throw new Error(`reopen saw ${again.reactor.size} of ${held}`);
      await gw.close();
      rows.push({ driver, path, held, median: median(times), p90: p90(times), reopen });
      console.error(
        `${driver} ${path} ${held}: median ${median(times).toFixed(2)} ms, reopen ${reopen.toFixed(0)} ms`,
      );
    }
  }
}
console.log("| driver | path | deltas held | append median ms | append p90 ms | reopen ms |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  console.log(
    `| ${r.driver} | ${r.path} | ${r.held} | ${r.median.toFixed(2)} | ${r.p90.toFixed(2)} | ${r.reopen.toFixed(0)} |`,
  );
}
