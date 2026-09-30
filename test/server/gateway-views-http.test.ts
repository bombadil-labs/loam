// The HTTP doors read a gateway as a view of its container's journal (ruling 13). Two gateways over
// one sqlite store: B serves, A writes. The anonymous door's openness check runs before any query,
// so it must read B's refreshed view, and on a container mount the host's refreshed view too. Both
// cases go red if the server checks openness against a stale view.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { SqliteBackend } from "../../src/store/sqlite.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";

const OP_SEED = "7d".repeat(32);
const OP = authorForSeed(OP_SEED);
const QUERY = JSON.stringify({ query: `{ plant(entity: "${FERN}") { height } }` });

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const it of opened.reverse()) await it.close();
  opened.length = 0;
});

// A writes and B serves, over the same container.
const twoViews = async (): Promise<{ a: Gateway; b: Gateway }> => {
  const file = join(mkdtempSync(join(tmpdir(), "loam-views-http-")), "store.sqlite");
  const a = await Gateway.boot(
    new SqliteBackend(file),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await a.append([observed(FERN, "height", 41, 1000, OP_SEED)]);
  const b = await Gateway.open(new SqliteBackend(file), { seed: OP_SEED });
  opened.push(a, b);
  return { a, b };
};

const serving = async (b: Gateway): Promise<(path: string) => Promise<string>> => {
  const handle: ServerHandle = await serve({
    mounts: { garden: b },
    tokens: { "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  opened.push(handle);
  return async (path) => {
    const res = await fetch(`${handle.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: QUERY,
    });
    return `${res.status} ${await res.text()}`;
  };
};

const openDoor = async (gw: Gateway, ts: number): Promise<Delta> => {
  const declaration = signClaims(publicClaims(["Plant"], OP, ts), OP_SEED);
  await gw.append([declaration]);
  return declaration;
};

describe("the HTTP doors read refreshed views", () => {
  it("a public surface declared through one gateway opens the anonymous door of another", async () => {
    const { a, b } = await twoViews();
    const ask = await serving(b);
    expect(await ask("/garden/graphql")).toMatch(/^401 /);
    await openDoor(a, 10_000);
    expect(await ask("/garden/graphql")).toMatch(/^200 .*"height":41/);
  });

  it("a public surface struck at the host through one gateway closes the other's container mount", async () => {
    const { a, b } = await twoViews();
    const door = await openDoor(a, 10_000);
    await b.append([
      signClaims(
        containerClaims(
          { container: "commons", trust: "curated", posture: "separate" },
          OP,
          10_100,
        ),
        OP_SEED,
      ),
    ]);
    const commons = await b.openContainer({ name: "commons", backend: new MemoryBackend() });
    const ask = await serving(b);
    expect(await ask("/commons/graphql")).toMatch(/^200 .*"height":41/);
    // The pool keeps its seeded copy of the declaration; the host's live word decides.
    await a.append([signClaims(makeNegationClaims(OP, 10_200, door.id), OP_SEED)]);
    expect(await ask("/commons/graphql")).toBe(await ask("/nowhere/graphql"));
    await commons.drop();
  });
});
