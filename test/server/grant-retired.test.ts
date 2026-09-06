// T279: container-bound registration is fenced by the binding; unbound grants survive.
import { describe, expect, it } from "vitest";
import { signClaims } from "@bombadil/rhizomatic";
import { readRegistrations } from "../../src/gateway/registration.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
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

  it("an unbound key holding a grant still registers: this retires it for CONNECTIONS", async () => {
    // The narrowing is aimed at a BINDING's fence. A token that names an actor and no container is
    // not a §58 connection, and its grant is untouched — otherwise this would be a different and
    // much larger change, made by accident.
    const { base, gateway } = await connectionServer({
      tokens: { "keyed-token": { actor: "4d".repeat(32) } },
    });
    const ada = await connect(base, "ada", "journal");
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
    expect(
      readRegistrations(gateway.reactor, gateway.operatorAuthor).map(
        (r) => r.lensName ?? r.hyperschema.name,
      ),
    ).toContain("sync:log");
    for (const inbox of gateway.connectionInboxes.values()) {
      if (inbox.gateway !== undefined) {
        expect(
          readRegistrations(inbox.gateway.reactor, inbox.gateway.operatorAuthor).map(
            (r) => r.lensName ?? r.hyperschema.name,
          ),
        ).not.toContain("sync:log");
      }
    }
    for (const bearer of ["op-token", ada]) {
      const res = await fetch(`${base}/default/graphql`, {
        method: "POST",
        headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
        body: JSON.stringify({ query: '{ sync_log(entity: "thing:1") { _entity } }' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { errors?: unknown[] };
      expect(body.errors).toBeUndefined();
    }
    await closeAll();
  });
});
