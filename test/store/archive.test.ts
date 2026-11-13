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

vi.setConfig({ testTimeout: 20_000 });

const signed = observed(FERN, "height", 30, 1000, GARDENER_SEED);
const other = observed(FERN, "height", 34, 2000, SURVEYOR_SEED);
const unsigned = makeDelta({
  timestamp: 3000,
  validFrom: 3000,
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
    expect(row.claims).toEqual(claimsToJson(signed.claims));
    expect(row.sig).toBe(signed.sig);
    const bare = JSON.parse(readFileSync(fileFor(root, unsigned.id), "utf8")) as { sig?: string };
    expect(bare.sig).toBeUndefined();
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
    writeFileSync(join(root, "README.txt"), "the seed vault\n");
    writeFileSync(join(root, ".DS_Store"), "junk");
    writeFileSync(join(root, "loose.json"), "{}");
    writeFileSync(join(root, signed.id.slice(0, 2), "notes.txt"), "not a delta");
    writeFileSync(join(root, signed.id.slice(0, 2), `${signed.id}.json.9999.tmp`), '{"claims');
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed]));
    writeFileSync(join(root, signed.id.slice(0, 2), `${"0".repeat(64)}.json`), "not json {");
    await expect(store.deltasSince(new Set())).rejects.toThrow(/corruption/);
    await store.close();
  });
});

describe("ArchiveBackend.holds sees the bytes, not the bookkeeping (ticket T67)", () => {
  it("a `.tmp` straggler planted BEHIND the seam still reads as held", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    const fan = join(root, signed.id.slice(0, 2));
    mkdirSync(fan, { recursive: true });
    writeFileSync(join(fan, `${signed.id}.json.9999.tmp`), '{"claims');

    expect(await store.deltasSince(new Set())).toEqual([]);
    expect(await store.holds(signed.id)).toBe(true);

    expect(await store.purge([signed.id])).toBe(1);
    expect(await store.holds(signed.id)).toBe(false);
    await store.close();
  });

  it("a misfiled copy in the wrong fan reads as held: holds hunts every fan, as purge does", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed]);
    const wrongFan = join(root, "zz");
    mkdirSync(wrongFan, { recursive: true });
    cpSync(
      join(root, signed.id.slice(0, 2), `${signed.id}.json`),
      join(wrongFan, `${signed.id}.json`),
    );
    rmSync(join(root, signed.id.slice(0, 2), `${signed.id}.json`), { force: true });
    expect(await store.holds(signed.id)).toBe(true);
    await store.close();
  });
});

describe("ArchiveBackend stays a set", () => {
  it("a misfiled copy (wrong fan) is still one delta: reads dedupe by id", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    await store.append([signed]);
    const wrongFan = join(root, "zz");
    mkdirSync(wrongFan, { recursive: true });
    cpSync(fileFor(root, signed.id), join(wrongFan, `${signed.id}.json`));
    expect(ids(await store.deltasSince(new Set()))).toEqual(ids([signed]));
    await store.close();
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
    await b.append([other, unsigned]);
    await a.close();
    await b.close();
    cpSync(rootA, rootB, { recursive: true, force: true });
    const merged = new ArchiveBackend(rootB);
    expect(ids(await merged.deltasSince(new Set()))).toEqual(ids([signed, other, unsigned]));
    await merged.close();
  });
});

describe("ArchiveBackend purge sweeps files, not id-by-fan", () => {
  it("removes canonical files and stragglers across many ids in one pass, counting distinct ids", async () => {
    const root = freshRoot();
    const store = new ArchiveBackend(root);
    const many = Array.from({ length: 60 }, (_, i) =>
      observed(FERN, "height", i, 5000 + i, GARDENER_SEED),
    );
    await store.append(many);

    const doomed = many.slice(0, 30);
    for (const d of doomed.slice(0, 15)) {
      writeFileSync(`${fileFor(root, d.id)}.31337.tmp`, readFileSync(fileFor(root, d.id)));
    }
    const neverHere = Array.from({ length: 15 }, (_, i) =>
      observed(FERN, "absent", i, 9000 + i, SURVEYOR_SEED),
    );

    const removed = await store.purge([...doomed.map((d) => d.id), ...neverHere.map((d) => d.id)]);
    expect(removed).toBe(30);

    const left = await store.deltasSince(new Set());
    expect(left.length).toBe(30);
    const stragglers = readdirSync(root, { withFileTypes: true })
      .filter((f) => f.isDirectory())
      .flatMap((f) => readdirSync(join(root, f.name)))
      .filter((name) => name.endsWith(".tmp"));
    expect(stragglers).toEqual([]);
    await store.close();
  });
});
