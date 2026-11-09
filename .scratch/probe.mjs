// Scratch probe (not for merge): where do the tests' homes live on a Windows runner, is that place
// excluded from Defender, and what does one durable write cost there vs the excluded RUNNER_TEMP?
import { mkdirSync, mkdtempSync, openSync, writeSync, fsyncSync, closeSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(join(process.argv[2], "package.json"));
const Database = require("better-sqlite3");
const dirs = { "os.tmpdir()": tmpdir(), RUNNER_TEMP: join(process.env.RUNNER_TEMP, "bench"), "D:\\unexcluded": "D:\\bench-unexcluded" };
const n = Number(process.argv[3] ?? 60);
const pct = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))].toFixed(1);
for (const [label, base] of Object.entries(dirs)) {
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "probe-"));
  const fs = [], sq = [];
  for (let i = 0; i < n; i++) {
    let t = performance.now();
    const p = join(root, `f${i}.tmp`);
    const fd = openSync(p, "w"); writeSync(fd, Buffer.alloc(4096, i)); fsyncSync(fd); closeSync(fd); renameSync(p, join(root, `f${i}`));
    fs.push(performance.now() - t);
    t = performance.now();
    const db = new Database(join(root, `s${i}.sqlite`));
    db.pragma("journal_mode = WAL"); db.pragma("synchronous = NORMAL");
    db.exec("CREATE TABLE IF NOT EXISTS t (k INTEGER PRIMARY KEY, v BLOB)");
    const ins = db.prepare("INSERT INTO t (v) VALUES (?)");
    for (let j = 0; j < 20; j++) ins.run(Buffer.alloc(512, j));
    db.pragma("wal_checkpoint(TRUNCATE)"); db.close();
    sq.push(performance.now() - t);
  }
  console.log(`${process.pid} ${label.padEnd(12)} ${root}\n    write+fsync+rename ms p50 ${pct(fs, .5)} p95 ${pct(fs, .95)} max ${pct(fs, 1)}\n    sqlite open/20 inserts/checkpoint/close ms p50 ${pct(sq, .5)} p95 ${pct(sq, .95)} max ${pct(sq, 1)}`);
  rmSync(root, { recursive: true, force: true });
}
