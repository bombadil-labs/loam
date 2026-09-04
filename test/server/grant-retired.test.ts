// T263 — `loam grant --verb=register` RETIRES FOR CONNECTIONS (SPEC §58: the container is the
// whole grant).
//
// §58 said it from the start and the doors have said it in two voices ever since: a bound
// connection registers under its container's path AND ITS COLON, and a grant could ALSO name a
// prefix anywhere. The union existed for one reason, written in `registerStanding`'s own comment:
// nothing a connection could do was to stop working before its replacement had landed. Derived
// standing landed. This removes the union.
//
// WHAT CHANGES, IN ONE SENTENCE: a connection's register fence is now its container and nothing
// else, whatever grants stand for its key.
//
// THIS IS A NARROWING, AND IT IS THE POINT. An operator could hand a connector a prefix outside
// any container it was bound to — that is precisely the store-wide authority §58 exists to end.
// The bytes are untouched: a standing grant delta stays readable, and stays lawful for anything
// that is not a connection's register fence. It simply confers no register standing on a bound
// connection any more, which is the same shape §58.6 already records for the store-wide grants
// that predate the section.
//
// THE MINT IS NOT WHAT RETIRES, and that boundary is load-bearing. `loam grant <id>
// --verb=register` hands standing to a KEY, and a key that is not a bound connection still holds
// it — the ledger rails of T205 and T230 pin that, and they are right. What retires is the UNION
// at the door: a binding's fence is its container, and a grant adds nothing to it.
//
// NOT HERE, and said so: the OPERATOR's own registration is untouched (it holds every prefix),
// and `registerPrefixesOf` keeps its other callers — this file pins only what a CONNECTION's
// register door reads.
//
// RAILS-RED on origin/main, this file copied in: 1 red, 2 green — 3 cases. TWO ARE CONTROLS, and
// they are the reason this file is as much about what does NOT change as what does: the mint still
// standing, and an unbound key's grant still conferring, are both true on the base and must stay
// true after. Only the granted-prefix case is red there, and it is the whole change.
//
// REVERT PROBES, MEASURED against this file as it stands — 3 cases.
//   the union with a granted prefix is restored     → 1 red, 2 green

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signClaims } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { run } from "../../src/cli/cli.js";
import { readContainerTable } from "../../src/gateway/container.js";
import { containerClaims } from "../../src/gateway/container.js";
import { SEALED_LEEWAY, type Leeway } from "../../src/gateway/leeway.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import {
  closeAll,
  connect,
  connectionServer,
  OPERATOR,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";

const OPEN: Leeway = { ...SEALED_LEEWAY, receive: true };
const PICK = { pick: { order: { byTimestamp: "desc" } } };

const declareAs = (gw: Gateway, container: string, leeway: Leeway): Promise<unknown> => {
  const standing = readContainerTable(gw.reactor, gw.operatorAuthor).containers.get(container);
  return gw.append([
    signClaims(
      containerClaims(
        {
          container,
          trust: standing?.trust ?? ("curated" as const),
          posture: standing?.posture ?? ("separate" as const),
          ...(standing?.parent === undefined ? {} : { parent: standing.parent }),
          ...(standing?.membership === undefined ? {} : { membership: standing.membership }),
          leeway,
        },
        OPERATOR,
        gw.nextTimestamp(),
      ),
      OPERATOR_SEED,
    ),
  ]);
};

async function registerAs(
  base: string,
  bearer: string,
  name: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${base}/default/register`, {
    method: "POST",
    headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
    body: JSON.stringify({
      hyperschema: {
        name,
        alg: 1,
        body: {
          op: "group",
          key: "byTargetContext",
          in: {
            op: "select",
            pred: { hasPointer: { targetEntity: { var: "root" } } },
            in: { op: "mask", policy: "drop", in: "input" },
          },
        },
      },
      schema: { props: { color: PICK }, default: PICK },
      roots: ["thing:1"],
      writable: ["color"],
    }),
  });
  return { status: res.status, body: await res.text() };
}

describe("§58 — a connection's fence is its container, and a grant adds nothing", () => {
  it("a grant naming a prefix outside the container confers no register standing", async () => {
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    await declareAs(gateway, "ada:journal", OPEN);

    // The grant an operator could mint before this slice: a prefix in nobody's container.
    const actor = readOAuthFile(connectorsHome).grants[0]!.actor;
    await gateway.append([
      signClaims(
        grantClaims(STORE_ENTITY, actor, "register", OPERATOR, gateway.nextTimestamp(), "sync:"),
        OPERATOR_SEED,
      ),
    ]);

    // TWO-SIDED, and the pair is the whole point. Inside the container: admitted, by the binding
    // alone. Outside it: refused, though a grant names that very prefix.
    const inside = await registerAs(base, ada, "ada:journal:log");
    expect(inside.status, `inside its own container: ${inside.body}`).toBe(200);
    const granted = await registerAs(base, ada, "sync:log");
    expect(granted.status, "the granted prefix confers nothing now").toBe(403);
    // The refusal is the register door's constitutional one, and it says nothing about the grant
    // — a caller learns that the act needs an operator, not that a prefix it holds was ignored.
    expect(granted.body, "the constitutional refusal").toMatch(/registration is constitutional/);
    expect(granted.body, "and it does not name the prefix the grant held").not.toContain("sync:");
    await closeAll();
  });

  it("the mint still stands: what retires is what a grant CONFERS on a connection", async () => {
    // THE CLI IS NOT THE THING BEING RETIRED, and getting that boundary wrong would have been a
    // much larger change made by accident. `loam grant <id> --verb=register` hands standing to a
    // KEY, and a key that is not a bound connection still holds it — the ledger rails of T205 and
    // T230 pin exactly that, and they are right. What §58 retires is the UNION: a binding's fence
    // is its container, and a grant adds nothing to it.
    const home = mkdtempSync(join(tmpdir(), "loam-grant-retired-"));
    try {
      const out: string[] = [];
      const err: string[] = [];
      const io = { out: (m: string) => out.push(m), err: (m: string) => err.push(m) };
      expect(await run(["init", "--home", home, "--no-user"], io)).toBe(0);
      const help = await run(["grant", "--help"], io);
      expect(help, "the verb is still documented").toBe(0);
      expect(out.join("\n"), "and still named").toMatch(/--verb=register/);
    } finally {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("an unbound key holding a grant still registers: this retires it for CONNECTIONS", async () => {
    // The narrowing is aimed at a BINDING's fence. A token that names an actor and no container is
    // not a §58 connection, and its grant is untouched — otherwise this would be a different and
    // much larger change, made by accident.
    const { base, gateway } = await connectionServer({
      tokens: { "keyed-token": { actor: "4d".repeat(32) } },
    });
    const { authorForSeed } = await import("@bombadil/rhizomatic");
    await gateway.append([
      signClaims(
        grantClaims(
          STORE_ENTITY,
          authorForSeed("4d".repeat(32)),
          "register",
          OPERATOR,
          gateway.nextTimestamp(),
          "sync:",
        ),
        OPERATOR_SEED,
      ),
    ]);
    const kept = await registerAs(base, "keyed-token", "sync:log");
    expect(kept.status, `an unbound key's grant still stands: ${kept.body}`).toBe(200);
    await closeAll();
  });
});
