// Revoking a connection whose owner grant names a user whose record the operator has struck. The
// user's root cannot be read, so the owner's voice cannot find everything that lets the connection
// write, and refuses. The operator's voice binds on every delegation, so it strikes every delegation
// to the connection held in the inbox, whoever signed it, and the revoke holds even if the record
// comes back or the user is re-pointed. Each case asks the delta (what is struck) and the door (who
// writes), with a bystander connection that must keep writing once its owner can.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { delegationClaims } from "../../src/gateway/principal.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER, GARDENER_SEED, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "./fixtures.js";

const OP_SEED = "5c".repeat(32);
const OP = authorForSeed(OP_SEED);
const CONN_SEED = "d7".repeat(32);
const CONN = authorForSeed(CONN_SEED);
const OTHER_SEED = "d8".repeat(32);
const OTHER = authorForSeed(OTHER_SEED);
const K3_SEED = "e3".repeat(32);
const K3 = authorForSeed(K3_SEED);

const op = (claims: Parameters<typeof signClaims>[0]): Delta => signClaims(claims, OP_SEED);

const open: Gateway[] = [];
afterEach(async () => {
  for (const gw of open.splice(0)) await gw.close();
});

// ada (root: the gardener's key) owns home:ada; CONN and OTHER are bound by her name.
async function world(): Promise<{
  gw: Gateway;
  record: Delta;
  conn: Gateway;
  connInbox: Awaited<ReturnType<Gateway["bindConnection"]>>;
  other: Gateway;
}> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
    { channelBackend: () => new MemoryBackend() },
  );
  open.push(gw);
  const record = op(userClaims("ada", OP, 501));
  await gw.append([
    op(grantClaims(STORE_ENTITY, GARDENER, "write", OP, 500)),
    record,
    op(rootClaims("ada", GARDENER, OP, 501)),
  ]);
  await gw.append([
    op(
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
    ),
  ]);
  const bindAs = (key: string) =>
    gw.bindConnection({
      container: "home:ada",
      connectionKey: key,
      ownerSeed: GARDENER_SEED,
      ownerName: "ada",
    });
  const connInbox = await bindAs(CONN);
  const otherInbox = await bindAs(OTHER);
  const conn = gw.connectionInboxes.get(connInbox.entity!)!.gateway!;
  const other = gw.connectionInboxes.get(otherInbox.entity!)!.gateway!;
  return { gw, record, conn, connInbox: gw.connectionInboxes.get(connInbox.entity!)!, other };
}

async function door(ground: Gateway, d: Delta): Promise<"admitted" | "refused"> {
  try {
    await ground.append([d]);
    return "admitted";
  } catch {
    return "refused";
  }
}

const delegationsTo = (pool: Gateway, key: string): Delta[] =>
  [...pool.reactor.snapshot()].filter(
    (d) =>
      d.claims.pointers.some(
        (p) =>
          p.role === "kind" && p.target.kind === "primitive" && p.target.value === "delegation",
      ) &&
      d.claims.pointers.some(
        (p) => p.role === "key" && p.target.kind === "primitive" && p.target.value === key,
      ),
  );

describe("revoke after the operator strikes the owner's user record", () => {
  it("the operator's voice revokes; the revoke holds when the record comes back", async () => {
    const { gw, record, conn, connInbox, other } = await world();
    const strike = op(makeNegationClaims(OP, 700, record.id));
    await gw.append([strike]);
    // With ada's record struck, nothing names her key: no connection of hers writes.
    expect(await door(conn, observed(FERN, "height", 1, 1000, CONN_SEED))).toBe("refused");

    await gw.revokeConnection({ inbox: connInbox, connectionKey: CONN, asPool: true });
    // delta: the gardener's delegation to CONN is struck
    const [d] = delegationsTo(conn, CONN);
    expect(conn.reactor.negationsOf(d!.id).length).toBeGreaterThan(0);

    // The operator restores ada's record by striking the strike.
    await gw.append([op(makeNegationClaims(OP, 800, strike.id))]);
    expect(await door(conn, observed(FERN, "height", 2, 1001, CONN_SEED))).toBe("refused");
    // bystander: OTHER, never revoked, writes again once ada is back
    expect(await door(other, observed(FERN, "height", 3, 1002, OTHER_SEED))).toBe("admitted");
    expect(
      delegationsTo(other, OTHER).every((x) => other.reactor.negationsOf(x.id).length === 0),
    ).toBe(true);
  });

  it("the owner's voice still refuses, and strikes nothing (a control)", async () => {
    const { gw, record, conn, connInbox } = await world();
    await gw.append([op(makeNegationClaims(OP, 700, record.id))]);
    const before = conn.reactor.size;
    await expect(
      gw.revokeConnection({ inbox: connInbox, connectionKey: CONN, ownerSeed: GARDENER_SEED }),
    ).rejects.toThrow(/root cannot be read now/);
    expect(conn.reactor.size).toBe(before);
  });

  it("a delegation from a key no one names yet is struck too, so a later re-point does not revive it", async () => {
    const { gw, record, conn, connInbox } = await world();
    // K3 signed a delegation to CONN in the inbox; K3 is nobody's root yet.
    const k3 = signClaims(delegationClaims(K3, CONN, connInbox.entity!, 650), K3_SEED);
    await conn.federate([k3]);
    await gw.append([op(makeNegationClaims(OP, 700, record.id))]);
    await gw.revokeConnection({ inbox: connInbox, connectionKey: CONN, asPool: true });
    expect(conn.reactor.negationsOf(k3.id).length).toBeGreaterThan(0);
    // The operator gives ada a new record, rooted at K3.
    await gw.append([op(userClaims("ada", OP, 900)), op(rootClaims("ada", K3, OP, 900))]);
    expect(await door(conn, observed(FERN, "height", 4, 1003, CONN_SEED))).toBe("refused");
  });
});
