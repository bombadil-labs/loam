// §37 (T114), criterion (v): `loam grant list` and `loam grant revoke <client>`.
//
// TWO-SIDED, because a one-sided rail cannot see the failure that matters. Revocation must close the
// door — on the very NEXT request, in the SAME live process, with no restart, because the operator
// who revokes a connector is usually revoking it for a reason that will not wait for a restart. And it
// must NOT take the history with it: the connector's past deltas keep naming their author, because a
// delta's author is the record of who said it and revoking a key does not un-say anything.
//
// The "same live process" half is what forces the design: an in-memory token table filled at boot
// would pass every other rail here and fail this one. So the server reads the token entry from
// oauth.json on the ask, and the CLI's write is visible to it immediately.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed } from "@bombadil/rhizomatic";
import { readSeed } from "../../src/cli/config.js";
import { run } from "../../src/cli/cli.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import {
  PASSWORD,
  bootStore,
  createUser,
  dropHome,
  makeHome,
  signIn,
  storeDeltas,
  testIo,
} from "./user-fixture.js";
import { readOAuthFile } from "../../src/server/oauth-file.js";
import {
  CLAUDE_REDIRECT,
  approve,
  bearer,
  codeFrom,
  formTokenIn,
  getAuthorize,
  gql,
  mcp,
  pkce,
  redeem,
  register,
  serveOAuth,
  wellFormedAuthorize,
  type ServedOAuth,
} from "./oauth-fixture.js";

vi.setConfig({ testTimeout: 30000 });

const MOSS = "plant:moss";

let home: string;
let served: ServedOAuth;
let session: { cookie: string; formToken: string };

beforeEach(async () => {
  home = makeHome();
  await bootStore(home);
  await createUser(home, "myk", PASSWORD);
  served = await serveOAuth(home, {
    prepare: (gateway) => {
      gateway.register(PLANT, PLANT_POLICY, [MOSS], undefined, PLANT_WRITABLE);
    },
  });
  session = await signIn(served.base);
});
afterEach(async () => {
  await served?.close();
  dropHome(home);
});

/** A connector, granted and holding a live token. */
async function connect(name = "Claude"): Promise<{ clientId: string; token: string }> {
  const client = await register(served.base, { name });
  expect(client.status).toBe(201);
  const secret = pkce();
  const params = wellFormedAuthorize(client.clientId, secret.challenge);
  const page = await getAuthorize(served.base, params, session.cookie);
  const approved = await approve(served.base, params, {
    cookie: session.cookie,
    formToken: formTokenIn(page.body),
  });
  const redeemed = await redeem(served.base, {
    grant_type: "authorization_code",
    code: codeFrom(approved)!,
    redirect_uri: CLAUDE_REDIRECT,
    client_id: client.clientId,
    code_verifier: secret.verifier,
  });
  expect(redeemed.res.status).toBe(200);
  return { clientId: client.clientId, token: redeemed.body["access_token"] as string };
}

const grant = (args: readonly string[]): Promise<{ code: number; out: string; err: string }> =>
  (async () => {
    const io = testIo();
    const code = (await run(["grant", ...args, "--home", home], io.io)) as number;
    return { code, out: io.out.join("\n"), err: io.err.join("\n") };
  })();

describe("loam grant list", () => {
  it("names every connector, its id and its author — and no secret", async () => {
    const connector = await connect("Claude");
    const listed = await grant(["list"]);
    expect(listed.code).toBe(0);
    expect(listed.out).toContain(connector.clientId);
    expect(listed.out).toContain("Claude");
    const file = readOAuthFile(home);
    expect(listed.out).toContain(file.grants[0]!.actor);
    // The seed and the token are the two things this command must never print.
    expect(listed.out).not.toContain(file.grants[0]!.actorSeed);
    expect(listed.out).not.toContain(connector.token);
    // It says how many live tokens the connector holds — the number the operator revokes.
    expect(listed.out).toMatch(/1 (live )?token/);
  });

  it("says so plainly when there is nothing to list", async () => {
    const listed = await grant(["list"]);
    expect(listed.code).toBe(0);
    expect(listed.out).toMatch(/no connector|nothing/i);
  });
});

describe("loam grant revoke", () => {
  it("(v) closes the door on the very next request of the SAME live process", async () => {
    const connector = await connect();
    // It works first — otherwise "it stopped working" proves nothing.
    expect(
      (
        await mcp(
          served.base,
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          bearer(connector.token),
        )
      ).status,
    ).toBe(200);

    const revoked = await grant(["revoke", connector.clientId]);
    expect(revoked.code).toBe(0);
    expect(revoked.out).toContain(connector.clientId);

    // NO RESTART. The same server object, the next request.
    const after = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      bearer(connector.token),
    );
    expect(after.status).toBe(401);
    // and the write door with it — a read refusal alone would not prove the identity is gone
    const wrote = await gql(
      served.base,
      `mutation { plant(entity: "${MOSS}", height: 5) { height } }`,
      bearer(connector.token),
    );
    expect(wrote.status).toBe(401);
  });

  it("(v) the connector's PAST deltas still name their author", async () => {
    const connector = await connect();
    const wrote = await gql(
      served.base,
      `mutation { plant(entity: "${MOSS}", height: 33) { height } }`,
      bearer(connector.token),
    );
    expect(wrote.status).toBe(200);
    const actor = readOAuthFile(home).grants[0]!.actor;

    await grant(["revoke", connector.clientId]);

    // The named live bystander: the delta the connector authored is untouched, author and all.
    const carriers = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(`"value":33`),
    );
    expect(carriers.length).toBe(1);
    expect(carriers[0]!.claims.author).toBe(actor);

    // And a reading still resolves the value, through the operator's own token.
    const read = await gql(
      served.base,
      `{ plant(entity: "${MOSS}") { height } }`,
      bearer("op-token"),
    );
    expect(((await read.json()) as { data: { plant: { height: number } } }).data.plant.height).toBe(
      33,
    );
  });

  it("(v) revocation removes the TOKEN and keeps the seed — history does not lose its author", async () => {
    const connector = await connect();
    const before = readOAuthFile(home);
    expect(before.tokens.length).toBe(1);

    await grant(["revoke", connector.clientId]);
    const after = readOAuthFile(home);
    expect(after.tokens).toEqual([]);
    // The seed stays. Deleting it would leave every delta it signed with an author nobody can account
    // for, and would make a re-grant mint a SECOND identity for one connector.
    expect(after.grants.length).toBe(1);
    expect(after.grants[0]!.actorSeed).toBe(before.grants[0]!.actorSeed);
    expect(after.clients.length).toBe(1);
  });

  it("(v) another connector's token is untouched — the sweep is not a purge", async () => {
    const mine = await connect("Claude");
    const other = await connect("Some Other Connector");
    expect(readOAuthFile(home).tokens.length).toBe(2);

    await grant(["revoke", mine.clientId]);

    const mineNow = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      bearer(mine.token),
    );
    expect(mineNow.status).toBe(401);
    const othersNow = await mcp(
      served.base,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      bearer(other.token),
    );
    expect(othersNow.status).toBe(200);
    const file = readOAuthFile(home);
    expect(file.tokens.length).toBe(1);
    expect(file.tokens[0]!.clientId).toBe(other.clientId);
  });

  it("(v) a re-grant after revocation reuses the SAME actor", async () => {
    // One connector, one author, across a revocation. A new seed here would split the connector's
    // history in two and leave the first half signed by a key nothing in the store accounts for.
    const first = await connect();
    const actor = readOAuthFile(home).grants[0]!.actor;
    await grant(["revoke", first.clientId]);

    const secret = pkce();
    const params = wellFormedAuthorize(first.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const again = await redeem(served.base, {
      grant_type: "authorization_code",
      code: codeFrom(approved)!,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: first.clientId,
      code_verifier: secret.verifier,
    });
    expect(again.res.status).toBe(200);
    const file = readOAuthFile(home);
    expect(file.grants.length).toBe(1);
    expect(file.grants[0]!.actor).toBe(actor);
    expect(again.body["access_token"]).not.toBe(first.token);
  });

  it("(v) a code issued BEFORE the revoke does not mint after it", async () => {
    // The report `revoke` prints — "a serving process refuses the next request that presents one" — is
    // false unless this holds. A code lives five minutes in the SERVING process's memory, which the CLI
    // cannot reach; without the generation bump, a code issued a moment before the revoke mints a
    // fresh working token a moment after it, on the same seed, and the door reopens.
    const client = await register(served.base, { name: "Claude" });
    const secret = pkce();
    const params = wellFormedAuthorize(client.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved)!;

    // The connector is approved but has not redeemed yet, so it holds no grant. Give it one first, so
    // the revoke has something to revoke, then issue a SECOND code and revoke before redeeming it.
    const firstSecret = pkce();
    const firstParams = wellFormedAuthorize(client.clientId, firstSecret.challenge);
    const firstPage = await getAuthorize(served.base, firstParams, session.cookie);
    const firstApproved = await approve(served.base, firstParams, {
      cookie: session.cookie,
      formToken: formTokenIn(firstPage.body),
    });
    const firstRedeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: codeFrom(firstApproved)!,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: firstSecret.verifier,
    });
    expect(firstRedeemed.res.status).toBe(200);

    const revoked = await grant(["revoke", client.clientId]);
    expect(revoked.code).toBe(0);
    expect(revoked.out).toMatch(/in flight|already in flight|will not mint/);

    // The code from before the revoke is dead.
    const stale = await redeem(served.base, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: secret.verifier,
    });
    expect(stale.res.status).toBe(400);
    expect(stale.body["access_token"]).toBeUndefined();
    expect(readOAuthFile(home).tokens).toEqual([]);

    // And a FRESH approval after the revoke still works — the generation moved, it did not seize up.
    const afterSecret = pkce();
    const afterParams = wellFormedAuthorize(client.clientId, afterSecret.challenge);
    const afterPage = await getAuthorize(served.base, afterParams, session.cookie);
    const afterApproved = await approve(served.base, afterParams, {
      cookie: session.cookie,
      formToken: formTokenIn(afterPage.body),
    });
    const afterRedeemed = await redeem(served.base, {
      grant_type: "authorization_code",
      code: codeFrom(afterApproved)!,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: client.clientId,
      code_verifier: afterSecret.verifier,
    });
    expect(afterRedeemed.res.status).toBe(200);
  });

  it("(v) revoking one connector does not kill another's code in flight", async () => {
    // The two-sided form of the same law. A generation bumped on every client, or a code table cleared
    // wholesale, would pass the rail above and break this one.
    const mine = await connect("Claude");
    const other = await register(served.base, { name: "Other" });
    const secret = pkce();
    const params = wellFormedAuthorize(other.clientId, secret.challenge);
    const page = await getAuthorize(served.base, params, session.cookie);
    const approved = await approve(served.base, params, {
      cookie: session.cookie,
      formToken: formTokenIn(page.body),
    });
    const code = codeFrom(approved)!;

    await grant(["revoke", mine.clientId]);

    const survives = await redeem(served.base, {
      grant_type: "authorization_code",
      code,
      redirect_uri: CLAUDE_REDIRECT,
      client_id: other.clientId,
      code_verifier: secret.verifier,
    });
    expect(survives.res.status).toBe(200);
    expect(survives.body["access_token"]).toMatch(/.+/);
  });

  it("(v) revoke names an unknown client rather than reporting a success it did not achieve", async () => {
    const res = await grant(["revoke", "not-a-client"]);
    expect(res.code).not.toBe(0);
    expect(res.err).toContain("not-a-client");
  });

  it("(v) revoke accepts the client NAME when it is unambiguous, and refuses when it is not", async () => {
    const connector = await connect("Claude");
    const byName = await grant(["revoke", "Claude"]);
    expect(byName.code).toBe(0);
    expect(readOAuthFile(home).tokens).toEqual([]);
    expect(byName.out).toContain(connector.clientId);

    // Two clients sharing a display name: picking either one would revoke the wrong connector.
    await connect("Twin");
    await connect("Twin");
    const ambiguous = await grant(["revoke", "Twin"]);
    expect(ambiguous.code).not.toBe(0);
    expect(ambiguous.err).toMatch(/two|both|more than one|ambiguous/i);
    // Nothing was revoked: a refusal that half-acted would be the worst of the three outcomes.
    expect(readOAuthFile(home).tokens.length).toBe(2);
  });

  it("(v) revoke wants a client, and says so", async () => {
    const res = await grant(["revoke"]);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/loam grant revoke/);
  });

  it("(v) the operator's own token is not a grant and cannot be revoked through this door", async () => {
    await connect();
    const res = await grant(["revoke", "op-token"]);
    expect(res.code).not.toBe(0);
    // and the operator token still opens the operator's doors
    expect(
      (await fetch(`${served.base}/default/health`, { headers: bearer("op-token") })).status,
    ).toBe(200);
  });

  it("(v) the grant delta in the ground is the operator's, and revoke leaves it alone", async () => {
    // Deliberately NOT struck. §37's revocation is about the door: the token goes. Striking the grant
    // would retire the connector's write standing as LAW, which is a bigger decision than "this
    // connector should stop having a token" and belongs to the operator explicitly.
    const connector = await connect();
    const actor = readOAuthFile(home).grants[0]!.actor;
    const operator = authorForSeed(readSeed(home));
    const grantDeltasBefore = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(actor),
    );
    expect(grantDeltasBefore.length).toBe(1);
    expect(grantDeltasBefore[0]!.claims.author).toBe(operator);

    await grant(["revoke", connector.clientId]);
    const grantDeltasAfter = (await storeDeltas(home)).filter((d) =>
      JSON.stringify(d.claims.pointers).includes(actor),
    );
    expect(grantDeltasAfter.map((d) => d.id)).toEqual(grantDeltasBefore.map((d) => d.id));
  });
});
