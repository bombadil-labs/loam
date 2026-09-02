// §58 S1b-ii and S1d (T262, criteria a, b, e and the door half of 8): the DATA doors a bound
// connection walks land its writes in the connection's INBOX POOL and never in the primary — the
// typed GraphQL and REST doors, the raw /append door (fenced to what the key itself signed), and
// the MCP mutate tool — and a store-wide write grant, even one the operator lands by hand for the
// key, changes nothing about where a bound write goes (S1d: the pre-§58 root grant is inert for
// `write`). A bound bearer cannot subscribe; whoami speaks the binding and reads write standing
// from the pool.
//
// REGISTER IS THE NAMED EXCEPTION, and it is not a leak: registration is constitutional (§17), its
// standing is an operator's explicit `loam grant --verb=register` and never the binding's, and its
// deltas land in the primary under the store's own signature exactly as they did before §58. The
// binding does not route it and does not refuse it. §58 position 2 gives a connection law under its
// own container path instead, and S2 is the slice that builds it (inbox-pool publish, the §47 fold,
// re-attach at boot). Until then a bound connection that holds a register grant shapes the store,
// which is the pre-§58 behaviour the docs still describe.
//
// Railed at both levels: which reactor holds the bytes, and what a reader resolves through the
// Plant lens — the bound bearer over its scope, the operator over the primary. Two-sided: every
// refusal keeps a named bystander (the operator's own append, a §57-shaped actor token, another
// person's pair) working exactly as before.
//
// NAMED GAP: `whoamiFor`'s `gateway === undefined` arm (its write-standing fail-closed) has no
// rail, because no caller can reach it — every door resolves its mount before it answers. It is a
// defensive branch, and mutation testing reports it as a survivor for exactly that reason.
//
// Erasure standing rule: every store here is the fixture's own mkdtemp/memory store.

import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { inboxName } from "../../src/gateway/container.js";
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

afterEach(closeAll);

const ACTOR_SEED = "5a".repeat(32); // a configured actor token — the §57-shaped bystander

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
    // Delta level: the pool has it, signed by the key; the primary has nothing of the key's.
    expect(heightDeltas(pool, 41).map((d) => d.claims.author)).toEqual([grant.actor]);
    expect(heightDeltas(gateway, 41)).toEqual([]);
    expect([...gateway.reactor.snapshot()].some((d) => d.claims.author === grant.actor)).toBe(
      false,
    );
    // Object level: the bound bearer reads its scope; the operator reads the primary.
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

    const own = heightClaim(grant.actorSeed, 44, gateway.nextTimestamp());
    const ok = await appendRaw(base, token, [own]);
    expect(ok.status).toBe(200);
    expect(pool.reactor.get(own.id)).toBeDefined();
    expect(gateway.reactor.get(own.id)).toBeUndefined();

    // A delta signed by another key rides nowhere on this token: the whole batch is refused and
    // nothing lands in either reactor — including the key's own delta beside it.
    const foreign = heightClaim(ACTOR_SEED, 45, gateway.nextTimestamp());
    const ownToo = heightClaim(grant.actorSeed, 46, gateway.nextTimestamp());
    const refused = await appendRaw(base, token, [ownToo, foreign]);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { errors: string[] }).errors[0]).toContain("own key signed");
    for (const gw of [pool, gateway]) {
      expect(gw.reactor.get(foreign.id)).toBeUndefined();
      expect(gw.reactor.get(ownToo.id)).toBeUndefined();
    }
    // The bystander: the operator's raw door appends into the primary as it always did.
    const operators = heightClaim(OPERATOR_SEED, 47, gateway.nextTimestamp());
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
    // The pre-§58 shape: the operator grants the key store-wide write by hand.
    for (const key of [grant.actor, authorForSeed(ACTOR_SEED)]) {
      await gateway.append([
        signClaims(
          grantClaims(STORE_ENTITY, key, "write", OPERATOR, gateway.nextTimestamp()),
          OPERATOR_SEED,
        ),
      ]);
    }
    expect(holdsGrant(gateway.reactor, STORE_ENTITY, grant.actor, "write", OPERATOR)).toBe(true);
    // The grant is REAL — the key may append to the primary through the library — which is what
    // makes the door's routing, and not a missing grant, the reason nothing lands there below.
    const direct = heightClaim(grant.actorSeed, 50, gateway.nextTimestamp());
    await gateway.append([direct]);
    expect(gateway.reactor.get(direct.id)).toBeDefined();

    // Through every door, the bound key still writes into its pool and the primary stays as it was.
    expect((await mutateHeight(base, token, 51)).status).toBe(200);
    expect(heightDeltas(pool, 51)).toHaveLength(1);
    expect(heightDeltas(gateway, 51)).toEqual([]);
    const raw = heightClaim(grant.actorSeed, 52, gateway.nextTimestamp());
    expect((await appendRaw(base, token, [raw])).status).toBe(200);
    expect(pool.reactor.get(raw.id)).toBeDefined();
    expect(gateway.reactor.get(raw.id)).toBeUndefined();
    // The other side: a §57-shaped actor token with the same store-wide grant writes to the
    // primary exactly as before — the routing is the binding's, not the door's.
    expect((await mutateHeight(base, "actor-token", 53)).status).toBe(200);
    expect(heightDeltas(gateway, 53).map((d) => d.claims.author)).toEqual([
      authorForSeed(ACTOR_SEED),
    ]);
  });

  it("the rendered-route and byte doors refuse a bound bearer in words; the operator's answers stand", async () => {
    const { base } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    // Each door's OWN answer to the operator, which is not 403 and differs between them: the app
    // door 404s an unknown route, the byte door gives its uniform refusal for a malformed ref.
    for (const [path, operatorSees] of [
      ["/default/app/some-route/plant:fern", 404],
      ["/default/bytes/abc?lens=Plant&entity=plant:fern", 401],
    ] as const) {
      const bound = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(bound.status, path).toBe(403);
      // A refusal a person reads, served as text — never a rendered page or a byte stream.
      expect(bound.headers.get("content-type"), path).toBe("text/plain; charset=utf-8");
      expect(await bound.text()).toContain("reads only that container");
      // The operator meets THE DOOR ITSELF and gets its own answer — 404, because neither the
      // route nor the byte ref exists here. Asserting the exact status rather than "not 403" is
      // what separates a binding refusal that fires from a door that refuses everyone: the two
      // callers get different answers on the same path.
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
    // Both tokens are the pair's, so both now write into the NEW pool: the binding is the pair's
    // latest word, not the token's.
    expect((await mutateHeight(base, second, 61)).status).toBe(200);
    expect((await mutateHeight(base, first, 62)).status).toBe(200);
    expect(heightDeltas(other, 61)).toHaveLength(1);
    expect(heightDeltas(other, 62)).toHaveLength(1);
    expect(heightDeltas(journal, 61)).toEqual([]);
    expect(heightDeltas(journal, 62)).toEqual([]);
    expect(heightDeltas(journal, 60)).toHaveLength(1);
    expect(heightDeltas(other, 60)).toEqual([]);
    // And the read follows the record: the bearer now reads ada:other, where 62 is the latest.
    expect(await heightVia(base, first)).toBe(62);
  });

  it("a record naming a stale inbox is corrected on the next redemption — a record is never the authority", async () => {
    const { base, connectorsHome, gateway } = await connectionServer();
    await connect(base, "ada", "journal");
    const grant = grantOf(connectorsHome, "ada");
    const real = grant.inbox!;

    // Corrupt the record the way only a hand-edit or a half-finished write could: the SAME
    // container, an inbox that never stood. The pool itself is untouched.
    const file = readOAuthFile(connectorsHome);
    writeOAuthFile(connectorsHome, {
      ...file,
      grants: file.grants.map((g) => ({ ...g, inbox: "inbox:ada:journal:never-stood" })),
    });
    expect(grantOf(connectorsHome, "ada").inbox).toBe("inbox:ada:journal:never-stood");

    // Consent again into the same container: the bind resumes the pool that actually stands, and
    // the record follows it rather than the other way round.
    await connect(base, "ada", "journal");
    expect(grantOf(connectorsHome, "ada").inbox).toBe(real);
    expect(grantOf(connectorsHome, "ada").container).toBe("ada:journal");
    // And the pool it names is the live one: a write through the door lands there.
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
    expect(holdsGrant(gateway.reactor, STORE_ENTITY, grant.actor, "write", OPERATOR)).toBe(false);

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
    // And the sentence follows the standing: one answer must not deny a write in its field and
    // promise it in its prose.
    expect(after["note"]).not.toContain("writes into its inbox");
    expect(after["note"]).toContain("no write standing");
    // The pool's own door refuses the key now — the GraphQL door reports a resolver refusal as
    // errors on a 200 — and nothing lands in the pool or the primary.
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
    expect(holdsGrant(gateway.reactor, STORE_ENTITY, grant.actor, "write", OPERATOR)).toBe(false);
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
    expect(struck).toEqual(["(none)"]); // the seam is reached with nothing store-wide to strike
    const negationsAfter = [...gateway.reactor.snapshot()].filter((d) =>
      d.claims.pointers.some((p) => p.role === "negates"),
    ).length;
    expect(negationsAfter).toBe(negationsBefore);
    expect(readOAuthFile(connectorsHome).grants).toEqual([]);

    // AND THE HALF THIS SEAM DOES NOT DO, asserted so the case cannot be read as "revoked whole".
    // The grant that carries the connection's standing lives in its pool, and striking the ground
    // never touches it. Access is gone regardless — the record and its seed are deleted — but a
    // caller that strikes only here leaves a live grant behind, which is what the CLI's own rail
    // (test/cli/grant-ledger-58.test.ts) proves it now strikes too.
    const pool = poolOf(gateway, grant.inbox!);
    expect(holdsGrant(pool.reactor, STORE_ENTITY, grant.actor, "write", OPERATOR)).toBe(true);
  });
});
