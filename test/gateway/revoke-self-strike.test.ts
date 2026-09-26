// A connection cannot make itself unrevocable. Its own strike on its write grant does not count for
// standing, so it must not hide that grant from the owner's revoke either. Asked at both levels: the
// revoke succeeds, and a write signed by the connection key is then refused. The bystander is a
// second connection in the same container, which still writes.

import { describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONN_SEED = "d7".repeat(32);
const OTHER_SEED = "d8".repeat(32);

async function home(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([signClaims(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500), OP_SEED)]);
  await gw.append([
    signClaims(
      containerClaims(
        {
          container: "home:ada",
          trust: "curated",
          posture: "shared",
          membership: {
            op: "select",
            pred: { match: { field: "author", cmp: "eq", const: GARDENER } },
            in: "input",
          },
        },
        OP,
        600,
      ),
      OP_SEED,
    ),
  ]);
  return gw;
}

const bind = async (gw: Gateway, seed: string) => {
  const inbox = (
    await gw.bindConnection({
      container: "home:ada",
      connectionKey: authorForSeed(seed),
      ownerSeed: GARDENER_SEED,
    })
  ).entity!;
  return gw.connectionInboxes.get(inbox)!;
};

describe("a connection's own strike on its write grant", () => {
  it("does not stop the owner revoking it", async () => {
    const gw = await home();
    const conn = await bind(gw, CONN_SEED);
    const other = await bind(gw, OTHER_SEED);
    const pool = conn.gateway!;
    await pool.append([observed(FERN, "height", 1, 1000, CONN_SEED)]); // control: it may write

    const grant = [...pool.reactor.snapshot()].find(
      (d) =>
        d.claims.author !== authorForSeed(CONN_SEED) &&
        JSON.stringify(d.claims).includes(authorForSeed(CONN_SEED)) &&
        JSON.stringify(d.claims).includes('"write"'),
    )!;
    expect(grant).toBeDefined();
    await pool.append([
      signClaims(makeNegationClaims(authorForSeed(CONN_SEED), 1100, grant.id), CONN_SEED),
    ]);
    await pool.append([observed(FERN, "height", 2, 1200, CONN_SEED)]); // its strike did not count

    await gw.revokeConnection({
      inbox: conn,
      connectionKey: authorForSeed(CONN_SEED),
      ownerSeed: GARDENER_SEED,
    });
    await expect(pool.append([observed(FERN, "height", 3, 1300, CONN_SEED)])).rejects.toThrow();
    await other.gateway!.append([observed(FERN, "tag", "shade", 1400, OTHER_SEED)]); // bystander
    await gw.close();
  });
});
