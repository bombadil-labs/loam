// §34 (h) — the operator path. `demos/board/boot.mjs` stands the whole board up from an EMPTY
// home in one run: identity, vocabulary, the fable grant, the renderer, the public declaration,
// and the start script. The rail executes the script exactly as an operator would (a node
// subprocess against the built package — `npm run check` builds dist first) and then reopens the
// home it left behind to prove every piece of law actually LANDED — no trust in the script's own
// report (H7).
//
// The home is this test's own mkdtempSync dir, never a real one (the standing erasure rule).

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { storePath } from "../../src/cli/config.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { lensOf } from "../../src/gateway/registration.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { BOARD_ENTITY, BOARD_ROUTE } from "../../demos/board/vocabulary.mjs";

vi.setConfig({ testTimeout: 60000 });

const run = promisify(execFile);
const BOOT = fileURLToPath(new URL("../../demos/board/boot.mjs", import.meta.url));

let home: string;
let gw: Gateway;
let handle: ServerHandle;
let base: string;
let fableSeed: string;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "loam-board-boot-"));
  await run(process.execPath, [BOOT, "--home", home]); // ONE run, empty home → whole app
  fableSeed = readFileSync(join(home, "fable.seed"), "utf8").trim();
  const seed = readFileSync(join(home, "operator.seed"), "utf8").trim();
  gw = await Gateway.boot(
    new SqliteBackend(storePath(home)),
    assembleGenesis({ operatorSeed: seed }),
  );
  handle = await serve({
    mounts: { board: gw },
    tokens: { op: { operator: true }, fable: { actor: fableSeed } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterAll(async () => {
  await handle.close();
  await gw.close();
  rmSync(home, { recursive: true, force: true });
});

const gql = async (query: string, token?: string) => {
  const res = await fetch(`${base}/board/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
};

describe("(h) one run over an empty home stands the whole app up", () => {
  it("leaves the operator files a re-boot needs: seeds, token, start script", () => {
    for (const f of ["operator.seed", "fable.seed", "door.token", "start.sh", "config.json"]) {
      expect(existsSync(join(home, f)), f).toBe(true);
    }
  });

  it("the vocabulary is LAW in the reopened store — both lenses, and the boardEvent template", () => {
    const lenses = gw.registered.map((r) => lensOf(r) as string);
    expect(lenses).toContain("BoardItem");
    expect(lenses).toContain("Board");
    const item = gw.registered.find((r) => (lensOf(r) as string) === "BoardItem");
    expect(Object.keys(item?.mutations ?? {})).toContain("boardEvent");
    const board = gw.registered.find((r) => (lensOf(r) as string) === "Board");
    expect(Object.keys(board?.mutations ?? {})).toContain("boardAdd");
  });

  it("the renderer and the public declaration landed: the page serves tokenless", async () => {
    const res = await fetch(`${base}/board/app/${BOARD_ROUTE}/${BOARD_ENTITY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("the board"); // the seeded banner renders
  });

  it("the minted fable identity holds write standing: a session reports through the door", async () => {
    const add = await gql(
      `mutation { boardAdd(board: ${JSON.stringify(BOARD_ENTITY)}, item: "board:first") { delta } }`,
      "fable",
    );
    expect(add.errors, JSON.stringify(add.errors)).toBeUndefined();
    const set = await gql(
      `mutation { boardItem(entity: "board:first", kind: "note", title: "the first report", status: "open") { title } }`,
      "fable",
    );
    expect(set.errors, JSON.stringify(set.errors)).toBeUndefined();
    const move = await gql(
      `mutation { boardEvent(item: "board:first", status: "building") { delta } }`,
      "fable",
    );
    expect(move.errors, JSON.stringify(move.errors)).toBeUndefined();
    const page = await fetch(`${base}/board/app/${BOARD_ROUTE}/${BOARD_ENTITY}`);
    expect(await page.text()).toContain("the first report");
  });

  it("a re-run re-expresses only the face: the constitution is content-addressed still", async () => {
    // Its own home, so no open gateway holds the sqlite file between runs. Two runs, counted at
    // the delta level: the grant and the declaration dedupe by content address (H4), the
    // registrations are skipped once bound, and the ONE delta a re-run adds is the renderer
    // re-push — how a re-boot carries a newer face to a standing store.
    const home2 = mkdtempSync(join(tmpdir(), "loam-board-reboot-"));
    try {
      await run(process.execPath, [BOOT, "--home", home2]);
      const seed2 = readFileSync(join(home2, "operator.seed"), "utf8").trim();
      const fable2 = authorForSeed(readFileSync(join(home2, "fable.seed"), "utf8").trim());
      const census = async (): Promise<{ deltas: number; grants: number }> => {
        const g = await Gateway.boot(
          new SqliteBackend(storePath(home2)),
          assembleGenesis({ operatorSeed: seed2 }),
        );
        const snapshot = [...g.reactor.snapshot()];
        const grants = snapshot.filter(
          (d) =>
            d.claims.pointers.some(
              (p) => p.target.kind === "entity" && p.target.entity.id === STORE_ENTITY,
            ) &&
            d.claims.pointers.some(
              (p) => p.target.kind === "primitive" && p.target.value === fable2,
            ),
        );
        await g.close();
        return { deltas: snapshot.length, grants: grants.length };
      };
      const first = await census();
      await run(process.execPath, [BOOT, "--home", home2]); // a rejected exec would throw here
      const second = await census();
      expect(second.grants).toBe(1);
      expect(second.deltas).toBe(first.deltas + 1); // the renderer re-push, and nothing else
    } finally {
      rmSync(home2, { recursive: true, force: true });
    }
  });
});
