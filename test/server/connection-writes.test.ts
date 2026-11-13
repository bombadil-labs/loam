import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { inboxName } from "../../src/gateway/container-law.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { toWire } from "../../src/federation/wire.js";
import { readOAuthFile, writeOAuthFile } from "../../src/server/oauth-file.js";
import { revokeConnector } from "../../src/server/oauth.js";
import { FERN } from "../spike/garden.js";
import {
  CLIENT_ID,
  OPERATOR,
  OPERATOR_SEED,
  closeAll,
  connect,
  connectionServer,
  grantOf,
  heightClaim,
  heightDeltas,
  heightVia,
  mutateHeight,
  poolOf,
  whoami,
} from "../helpers/connection-fixture.js";
import { withStamp } from "../../src/gateway/stamp.js";

afterEach(closeAll);

const ACTOR_SEED = "5a".repeat(32);

const appendRaw = (
  base: string,
  token: string,
  deltas: readonly ReturnType<typeof heightClaim>[],
) =>
  fetch(`${base}/default/append`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ deltas: deltas.map(toWire) }),
  });

describe("S1b-ii — a bound connection's writes land in its inbox pool, never the primary", () => {
  it("GraphQL: the pool holds the claim, the primary holds none of the key's; each door reads its own ground", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const pool = poolOf(gateway, grant.inbox!);

    const wrote = await mutateHeight(base, token, 41);
    expect(wrote.status).toBe(200);
    expect(
      ((await wrote.json()) as { data: { plant: { height: number } } }).data.plant.height,
    ).toBe(41);
    expect(heightDeltas(pool, 41).map((d) => d.claims.author)).toEqual([grant.actor]);
    expect(heightDeltas(gateway, 41)).toEqual([]);
    expect([...gateway.reactor.snapshot()].some((d) => d.claims.author === grant.actor)).toBe(
      false,
    );
    expect(await heightVia(base, token)).toBe(41);
    expect(await heightVia(base, "op-token")).toBeNull();
  });

  it("REST: a POST lands in the pool and a GET with the bearer reads it; the operator's GET does not", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const posted = await fetch(`${base}/default/rest/v1/Plant/${encodeURIComponent(FERN)}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ height: 42 }),
    });
    expect(posted.status).toBe(200);
    expect(heightDeltas(poolOf(gateway, grant.inbox!), 42)).toHaveLength(1);
    expect(heightDeltas(gateway, 42)).toEqual([]);
    const got = async (bearer: string): Promise<unknown> =>
      (
        (await (
          await fetch(`${base}/default/rest/v1/Plant/${encodeURIComponent(FERN)}`, {
            headers: { authorization: `Bearer ${bearer}` },
          })
        ).json()) as { view: { height?: unknown } }
      ).view.height ?? null;
    expect(await got(token)).toBe(42);
    expect(await got("op-token")).toBeNull();
  });

  it("the MCP mutate tool lands in the pool too", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const res = await fetch(`${base}/default/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "loam_mutate",
          arguments: { mutation: `mutation { plant(entity: "${FERN}", height: 43) { height } }` },
        },
      }),
    });
    expect(res.status).toBe(200);
    expect(heightDeltas(poolOf(gateway, grant.inbox!), 43)).toHaveLength(1);
    expect(heightDeltas(gateway, 43)).toEqual([]);
  });

  it("/append: a batch the key signed lands in the pool; a foreign-signed delta is refused whole; the operator's door is untouched", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const pool = poolOf(gateway, grant.inbox!);

    const own = heightClaim(grant.actorSeed, 44, gateway.stamp(grant.actor));
    const ok = await appendRaw(base, token, [own]);
    expect(ok.status).toBe(200);
    expect(pool.reactor.get(own.id)).toBeDefined();
    expect(gateway.reactor.get(own.id)).toBeUndefined();

    const foreign = heightClaim(ACTOR_SEED, 45, gateway.stamp(authorForSeed(ACTOR_SEED)));
    const ownToo = heightClaim(grant.actorSeed, 46, gateway.stamp(grant.actor));
    const refused = await appendRaw(base, token, [ownToo, foreign]);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: string[] }).errors[0]).toContain("own key signed");
    for (const gw of [pool, gateway]) {
      expect(gw.reactor.get(foreign.id)).toBeUndefined();
      expect(gw.reactor.get(ownToo.id)).toBeUndefined();
    }
    const operators = heightClaim(OPERATOR_SEED, 47, gateway.stamp(OPERATOR));
    expect((await appendRaw(base, "op-token", [operators])).status).toBe(200);
    expect(gateway.reactor.get(operators.id)).toBeDefined();
  });

  it("S1d, two-sided: a store-wide write grant the operator lands for the key changes nothing at the doors", async () => {
    const { base, connectorsHome, gateway } = await connectionServer({
      tokens: { "actor-token": { actor: ACTOR_SEED } },
    });
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const pool = poolOf(gateway, grant.inbox!);
    for (const key of [grant.actor, authorForSeed(ACTOR_SEED)]) {
      await gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) => grantClaims(STORE_ENTITY, key, "write", OPERATOR, t)),
          OPERATOR_SEED,
        ),
      ]);
    }
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        OPERATOR,
      ),
    ).toBe(true);
    const direct = heightClaim(grant.actorSeed, 50, gateway.stamp(grant.actor));
    await gateway.append([direct]);
    expect(gateway.reactor.get(direct.id)).toBeDefined();

    expect((await mutateHeight(base, token, 51)).status).toBe(200);
    expect(heightDeltas(pool, 51)).toHaveLength(1);
    expect(heightDeltas(gateway, 51)).toEqual([]);
    const raw = heightClaim(grant.actorSeed, 52, gateway.stamp(grant.actor));
    expect((await appendRaw(base, token, [raw])).status).toBe(200);
    expect(pool.reactor.get(raw.id)).toBeDefined();
    expect(gateway.reactor.get(raw.id)).toBeUndefined();
    expect((await mutateHeight(base, "actor-token", 53)).status).toBe(200);
    expect(heightDeltas(gateway, 53).map((d) => d.claims.author)).toEqual([
      authorForSeed(ACTOR_SEED),
    ]);
  });

  it("the rendered-route and byte doors refuse a bound bearer in words; the operator's answers stand", async () => {
    const { base } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    for (const [path, operatorSees] of [
      ["/default/app/some-route/plant:fern", 404],
      ["/default/bytes/abc?lens=Plant&entity=plant:fern", 401],
    ] as const) {
      const bound = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(bound.status, path).toBe(403);
      expect(bound.headers.get("content-type"), path).toBe("text/plain; charset=utf-8");
      expect(await bound.text()).toContain("reads only that container");
      const op = await fetch(`${base}${path}`, { headers: { authorization: "Bearer op-token" } });
      expect(op.status, path).toBe(operatorSees);
      expect(await op.text()).not.toContain("reads only that container");
    }
  });

  it("a bound bearer cannot subscribe (403, in words); the operator still can", async () => {
    const { base } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const query = encodeURIComponent(`subscription { plant(entity: "${FERN}") { height } }`);
    const refused = await fetch(`${base}/default/subscribe?query=${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: string[] }).errors[0]).toContain(
      "cannot subscribe",
    );
    const control = new AbortController();
    const opened = await fetch(`${base}/default/subscribe?query=${query}`, {
      headers: { authorization: "Bearer op-token" },
      signal: control.signal,
    });
    expect(opened.status).toBe(200);
    control.abort();
  });

  it("a re-consent into another container moves the key's next write into the new pool; the old pool keeps only the old", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    const first = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const journal = poolOf(gateway, grant.inbox!);
    expect((await mutateHeight(base, first, 60)).status).toBe(200);

    const second = await connect(base, "ada", "other");
    const after = grantOf(connectorsHome, "ada");
    expect(after.actor).toBe(grant.actor);
    expect(after.inbox).toBe(inboxName("ada:other", grant.actor));
    const other = poolOf(gateway, after.inbox!);
    expect((await mutateHeight(base, second, 61)).status).toBe(200);
    expect((await mutateHeight(base, first, 62)).status).toBe(200);
    expect(heightDeltas(other, 61)).toHaveLength(1);
    expect(heightDeltas(other, 62)).toHaveLength(1);
    expect(heightDeltas(journal, 61)).toEqual([]);
    expect(heightDeltas(journal, 62)).toEqual([]);
    expect(heightDeltas(journal, 60)).toHaveLength(1);
    expect(heightDeltas(other, 60)).toEqual([]);
    expect(await heightVia(base, first)).toBe(62);
  });

  it("a record naming a stale inbox is corrected on the next redemption — a record is never the authority", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const real = grant.inbox!;

    const file = readOAuthFile(connectorsHome);
    writeOAuthFile(connectorsHome, {
      ...file,
      grants: file.grants.map((g) => ({ ...g, inbox: "inbox:ada:journal:never-stood" })),
    });
    expect(grantOf(connectorsHome, "ada").inbox).toBe("inbox:ada:journal:never-stood");

    await connect(base, "ada", "journal");
    expect(grantOf(connectorsHome, "ada").inbox).toBe(real);
    expect(grantOf(connectorsHome, "ada").container).toBe("ada:journal");
    const token = await connect(base, "ada", "journal");
    expect((await mutateHeight(base, token, 80)).status).toBe(200);
    expect(heightDeltas(poolOf(gateway, real), 80)).toHaveLength(1);
  });

  it("whoami speaks the binding and reads write standing from the pool; a struck pool flips it without a restart", async () => {
    const { base, connectorsHome, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const before = (await (await whoami(base, token)).json()) as Record<string, unknown>;
    expect(before).toMatchObject({
      kind: "connector",
      clientId: CLIENT_ID,
      author: grant.actor,
      write: true,
      binding: { user: "ada", container: "ada:journal", inbox: grant.inbox },
    });
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        OPERATOR,
      ),
    ).toBe(false);

    const { readUserSeed } = await import("../../src/cli/config.js");
    const owner = readUserSeed(usersHome, "ada");
    expect(owner.kind).toBe("present");
    await gateway.revokeConnection({
      inbox: gateway.connectionInboxes.get(grant.inbox!)!,
      connectionKey: grant.actor,
      ownerSeed: (owner as { seed: string }).seed,
    });
    const after = (await (await whoami(base, token)).json()) as Record<string, unknown>;
    expect(after["kind"]).toBe("connector");
    expect(after["write"]).toBe(false);
    expect(after["note"]).not.toContain("writes into its inbox");
    expect(after["note"]).toContain("no write standing");
    const refused = (await (await mutateHeight(base, token, 70)).json()) as { errors?: string[] };
    expect(refused.errors?.join("\n")).toMatch(/not permitted/);
    expect(heightDeltas(poolOf(gateway, grant.inbox!), 70)).toEqual([]);
    expect(heightDeltas(gateway, 70)).toEqual([]);
  });

  it("revoking a pair lands no negation in the primary: there was never a store-wide grant to strike", async () => {
    const { base, connectorsHome, gateway, faults } = await connectionServer();
    await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const negationsBefore = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "negates"),
    ).length;
    expect(
      holdsGrant(
        gateway.reactor,
        gateway.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        OPERATOR,
      ),
    ).toBe(false);
    const struck: string[] = [];
    const outcome = await revokeConnector(
      connectorsHome,
      CLIENT_ID,
      (g) => {
        struck.push(g.grantDeltaId ?? "(none)");
        return Promise.resolve();
      },
      (m) => faults.push(m),
      { kind: "pair", user: "ada" },
    );
    expect(outcome.kind).toBe("revoked");
    expect(struck).toEqual(["(none)"]);
    const negationsAfter = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "negates"),
    ).length;
    expect(negationsAfter).toBe(negationsBefore);
    expect(readOAuthFile(connectorsHome).grants).toEqual([]);

    const pool = poolOf(gateway, grant.inbox!);
    expect(
      holdsGrant(
        pool.reactor,
        pool.validityNow(),
        STORE_ENTITY,
        grant.actor,
        "write",
        pool.operatorAuthor,
      ),
    ).toBe(true);
  });
});
