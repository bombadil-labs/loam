// An inbox's grants are its own law, read with the POOL's key (step 6 inventory, pattern 3). Under
// today's shared key the host's and the pool's keys agree; under a pool key of its own (through
// `childSeed`, as step 6 will give it) only the pool's key finds the grant. Both are pinned.

import { afterEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { containerClaims, inboxName, openerStands } from "../../src/gateway/container.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { connectionGrantState } from "../../src/server/admin-federation.js";
import { rootClaims, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "5c".repeat(32);
const OWNER_SEED = "a1".repeat(32);
const CONN = authorForSeed("c1".repeat(32));

const open: Gateway[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const gw of open.splice(0)) await gw.close();
});

async function bound(poolSeed?: string) {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: SEED }));
  open.push(gw);
  const op = gw.operatorAuthor!;
  await gw.append([
    gw.signer!.sign(userClaims("ada", op, 20)),
    gw.signer!.sign(rootClaims("ada", authorForSeed(OWNER_SEED), op, 21)),
    gw.signer!.sign(
      containerClaims({ container: "home", trust: "curated", posture: "separate" }, op, 22),
    ),
  ]);
  if (poolSeed !== undefined) vi.spyOn(gw, "childSeed").mockReturnValue(poolSeed);
  await gw.bindConnection({
    container: "home",
    connectionKey: CONN,
    ownerSeed: OWNER_SEED,
    ownerName: "ada",
  });
  const name = inboxName("home", CONN);
  return { gw, name, pool: gw.connectionInboxes.get(name)!.gateway! };
}

describe("inbox grants are read with the pool's key", () => {
  for (const [label, poolSeed] of [
    ["shared key (today)", undefined],
    ["a pool key of its own", "7e".repeat(32)],
  ] as const) {
    it(`a bound connection stands, for the opener cascade and the connections panel: ${label}`, async () => {
      const { gw, name, pool } = await bound(poolSeed);
      expect(pool.operatorAuthor === gw.operatorAuthor).toBe(poolSeed === undefined);
      expect(openerStands(gw, { openedBy: "home", openedFrom: name })).toBe(true);
      expect(
        connectionGrantState(pool.reactor, pool.validityNow(), pool.operatorAuthor, CONN),
      ).toBe("active");
    });
  }
});
