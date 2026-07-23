// The cold driver's own promises, beyond the shared contract. An archive is a directory of
// canonical delta files — `<root>/<id[0..2)>/<id>.json` — where the FILENAME is the content
// address. That buys three things worth pinning: the layout is stable (rsync/tar/cp are backup
// tools), a file that does not recompute to its own name is corruption (a rename cannot forge a
// delta), and copying files between two archives IS replication, because union-by-id is the
// merge and the id is the name.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { claimsToJson, makeDelta, type Delta } from "@bombadil/rhizomatic";
import { ArchiveBackend } from "../../src/store/archive.js";
import { FERN, GARDENER_SEED, SURVEYOR_SEED, observed } from "../spike/garden.js";

// The archive does real filesystem work — one file per delta, write+fsync+rename each — and the
// many-ids purge sweep writes ~100 of them, which blows vitest's 5s default on a loaded CI
// runner. The same generous hang-guard the other heavy suites carry; it only ever matters when
// something is genuinely stuck.
vi.setConfig({ testTimeout: 15000 });

const signed = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const other = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const unsigned = makeDelta({
  timestamp: 3000,
  author: "did:key:zAnon",
  pointers: [{ role: "note", target: { kind: "primitive", value: "cold but true" } }],
});

const ids = (deltas: readonly Delta[]) => deltas.map((d) => d.id).sort();
const fileFor = (root: string, id: string) => join(root, id.slice(0, 2), `${id}.json`);

const tmp = mkdtempSync(join(tmpdir(), "loam-archive-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
let n = 0;
const freshRoot = () => join(tmp, `vault-${n++}`);

describe("ArchiveBackend layout", () => {
  it("one delta, one file, named by its id, fanned out by its prefix", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed, unsigned]);
    const row = JSON.parse(readFileSync(fileFor(root, signed.id), "utf8")) as {
      claims: unknown;
      sig?: string;
    };
    expect(row.claims).toEqual(claimsToJson(signed.claims)); // canonical claims, human-readable
    expect(row.sig).toBe(signed.sig);
    const bare = JSON.parse(readFileSync(fileFor(root, unsigned.id), "utf8")) as { sig?: string };
    expect(bare.sig).toBeUndefined(); // no signature, no field — nothing to disagree with later
    await store.close();
  });

  it("a renamed file is corruption: the filename IS the identity", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed]);
    await store.close();
    const wrongName = `${"f".repeat(4)}${signed.id.slice(4)}`;
    mkdirSync(join(root, wrongName.slice(0, 2)), { recursive: true });
    renameSync(fileFor(root, signed.id), fileFor(root, wrongName));
    const again = new ArchiveBackend(root);
    await expect(again.deltasSince(new Set())).rejects.toThrow(/corruption/);
    await again.close();
  });

  it("stray non-delta files are not the archive's problem; broken delta files are", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed]);
    // the clutter real directories accumulate — ignored, in the root and in the fan
    writeFileSync(join(root, "README.txt"), "the seed vault\n");
    writeFileSync(join(root, ".DS_Store"), "junk");
    writeFileSync(join(root, "loose.json"), "{}"); // only the fan holds deltas; the root is porch
    writeFileSync(join(root, signed.id.slice(0, 2), "notes.txt"), "not a delta");
    // the straggler a crash leaves behind — half-written, never renamed, ignored by reads
    writeFileSync(join(root, signed.id.slice(0, 2), `${signed.id}.json.9999.tmp`), '{"claims');
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed]));
    // but a delta-shaped file that cannot be read back is corruption, refused loudly
    writeFileSync(join(root, signed.id.slice(0, 2), `${"0".repeat(64)}.json`), "not json {");
    await expect(store.deltasSince(new Set())).rejects.toThrow(/corruption/);
    await store.close();
  });
});

describe("ArchiveBackend stays a set", () => {
  it("a misfiled copy (wrong fan) is still one delta: reads dedupe by id", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed]);
    // a human drags a copy into the wrong fan — union tolerates the file, reads stay a set
    const wrongFan = join(root, "zz");
    mkdirSync(wrongFan, { recursive: true });
    cpSync(fileFor(root, signed.id), join(wrongFan, `${signed.id}.json`));
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed]));
    await store.close();
    // a fresh handle (no memory of the write) also returns the set exactly once
    const again = new ArchiveBackend(root);
    expect(ids(await again.deltasSince(new Set()))).toEqual(ids([signed]));
    await again.close();
  });
});

describe("ArchiveBackend replication by copy", () => {
  it("copying files between archives is a merge: union by name", async () => {
    const rootA = freshRoot();
    const rootB = freshRoot();
    const a = new ArchiveBackend(rootA);
    const b = new ArchiveBackend(rootB);
    await a.append([signed, unsigned]);
    await b.append([other, unsigned] /* one overlap — copies collide harmlessly */);
    await a.close();
    await b.close();
    cpSync(rootA, rootB, { recursive: true, force: true }); // rsync, tar, a USB stick — same move
    const merged = new ArchiveBackend(rootB);
    expect(ids(await merged.deltasSince(new Set()))).toEqual(ids([signed, other, unsigned]));
    await merged.close();
  });
});

describe("ArchiveBackend purge sweeps files, not id-by-fan", () => {
  it("removes canonical files and stragglers across many ids in one pass, counting distinct ids", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    const many = Array.from({ length: 200 }, (_, i) =>
      observed(FERN, "height", i, 5000 + i, GARDENER_SEED),
    );
    await store.append(many);

    // Half get a crash-left straggler beside them; a quarter are purged with no file at all (the
    // already-swept case a retry produces), so the count must be DISTINCT IDS ACTUALLY FOUND.
    const doomed = many.slice(0, 100);
    for (const d of doomed.slice(0, 50)) {
      writeFileSync(`${fileFor(root, d.id)}.31337.tmp`, readFileSync(fileFor(root, d.id)));
    }
    const neverHere = Array.from({ length: 50 }, (_, i) =>
      observed(FERN, "absent", i, 9000 + i, SURVEYOR_SEED),
    );

    const removed = await store.purge([...doomed.map((d) => d.id), ...neverHere.map((d) => d.id)]);
    expect(removed).toBe(100);

    const left = await store.deltasSince(new Set());
    expect(left.length).toBe(100);
    // No straggler survives — the assertion that reads the directory rather than the API.
    const stragglers = readdirSync(root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .flatMap((f) => readdirSync(join(root, f.name)))
      .filter((name) => name.endsWith(".tmp"));
    expect(stragglers).toEqual([]);
    await store.close();
  });
});
