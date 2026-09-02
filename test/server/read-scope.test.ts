// §58 S1c (T262, criterion 3): a bound connection READS the container its consent named — the
// person's own claims there, its own pool's claims, and nothing outside — through every read door:
// GraphQL, the listing, REST (with a time pin), and the MCP query tool. The operator's read stays
// the primary's, which never composes the pool. After a re-consent the read follows the new
// container.
//
// Two-sided at every step: what is in scope resolves (the positive control), what is outside does
// not, and the operator's read shows the outside claim so an empty scope cannot pass vacuously.
//
// Erasure standing rule: every store here is the fixture's own mkdtemp/memory store.

import { afterEach, describe, expect, it } from "vitest";
import { readUserSeed } from "../../src/cli/config.js";
import { FERN, observed } from "../spike/garden.js";
import {
  OPERATOR_SEED,
  closeAll,
  connect,
  connectionServer,
  graphql,
  grantOf,
  heightVia,
  mutateHeight,
} from "../helpers/connection-fixture.js";

afterEach(closeAll);

const MOSS = "plant:moss";
const OAK = "plant:oak";

const seedOf = (usersHome: string, user: string): string => {
  const owner = readUserSeed(usersHome, user);
  if (owner.kind !== "present") throw new Error(`no seed for ${user}`);
  return owner.seed;
};

describe("S1c — a bound read resolves over the bound container's scope", () => {
  it("GraphQL: the person's own claim and the pool's resolve; the operator's claim outside does not", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    // ada's OWN claim in the primary: a member of her home, so of the bound container's scope.
    await gateway.append([
      observed(FERN, "height", 30, gateway.nextTimestamp(), seedOf(usersHome, "ada")),
    ]);
    // The operator's claim in the primary: nobody's member, later than ada's.
    await gateway.append([observed(FERN, "height", 99, gateway.nextTimestamp(), OPERATOR_SEED)]);
    expect(await heightVia(base, token)).toBe(30); // ada's, not the operator's later 99
    expect(await heightVia(base, "op-token")).toBe(99);
    // The pool's claim is the latest in scope; the operator still reads the primary.
    expect((await mutateHeight(base, token, 31)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(31);
    expect(await heightVia(base, "op-token")).toBe(99);
  });

  it("the listing pages the scope only; the operator's listing sees the whole store", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    await gateway.append([
      observed(FERN, "height", 30, gateway.nextTimestamp(), seedOf(usersHome, "ada")),
    ]);
    await gateway.append([observed(OAK, "height", 1, gateway.nextTimestamp(), OPERATOR_SEED)]);
    const wrote = await graphql(
      base,
      token,
      `mutation { plant(entity: "${MOSS}", tag: "pooled") { tag } }`,
    );
    expect(wrote.status).toBe(200);
    const list = async (bearer: string): Promise<string[]> => {
      const res = await graphql(
        base,
        bearer,
        `
          {
            plants(limit: 10) {
              _entity
            }
          }
        `,
      );
      const body = (await res.json()) as { data?: { plants: { _entity: string }[] } };
      return body.data?.plants.map((p) => p._entity) ?? [];
    };
    expect(await list(token)).toEqual([FERN, MOSS]);
    expect(await list("op-token")).toEqual([FERN, OAK]);
  });

  it("REST with a time pin: the pinned read is the SCOPE as it stood, not the store as it stood", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    await gateway.append([
      observed(FERN, "height", 30, gateway.nextTimestamp(), seedOf(usersHome, "ada")),
    ]);
    expect((await mutateHeight(base, token, 31)).status).toBe(200);
    // An OUT-OF-SCOPE claim, later than the connection's own: without the scoping the pinned read
    // below would answer 99, so this is what makes the pin a scope assertion rather than a clock one.
    await gateway.append([observed(FERN, "height", 99, gateway.nextTimestamp(), OPERATOR_SEED)]);
    const at = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    expect((await mutateHeight(base, token, 32)).status).toBe(200);
    const rest = async (bearer: string, asOf?: number): Promise<unknown> => {
      const url = `${base}/default/rest/v1/Plant/${encodeURIComponent(FERN)}${asOf === undefined ? "" : `?asOf=${asOf}`}`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${bearer}` } });
      return ((await res.json()) as { view: { height?: unknown } }).view.height ?? null;
    };
    expect(await rest(token)).toBe(32);
    expect(await rest(token, at)).toBe(31);
    // The control: at that same moment the STORE really did hold 99, and the operator reads it —
    // so 31 above is the scope narrowing the pin, never the pin missing a delta.
    expect(await rest("op-token", at)).toBe(99);
  });

  it("the MCP query tool reads the scope", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    await gateway.append([
      observed(FERN, "height", 30, gateway.nextTimestamp(), seedOf(usersHome, "ada")),
    ]);
    await gateway.append([observed(FERN, "height", 99, gateway.nextTimestamp(), OPERATOR_SEED)]);
    const res = await fetch(`${base}/default/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "loam_query",
          arguments: { query: `{ plant(entity: "${FERN}") { height } }` },
        },
      }),
    });
    const body = (await res.json()) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(body.result.content[0]!.text)).toMatchObject({
      data: { plant: { height: 30 } },
    });
  });

  it("after a re-consent the read follows the new container, and the old pool falls out of scope", async () => {
    const { base, connectorsHome, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    // ada's own claim FIRST, so it is the older one: what the read falls back to is then a fact
    // about scope, not about the clock.
    await gateway.append([
      observed(FERN, "height", 30, gateway.nextTimestamp(), seedOf(usersHome, "ada")),
    ]);
    expect((await mutateHeight(base, token, 40)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(40); // in scope, and the latest

    await connect(base, "ada", "other");
    expect(grantOf(connectorsHome, "ada").container).toBe("ada:other");
    // The journal's pool composes into ada:journal, never into ada:other — so 40 is OUT of scope
    // now, though it is still the latest claim anywhere and the store still holds it. ada's own
    // claim (a member of every container under her home) is what the same token now resolves.
    expect(await heightVia(base, token)).toBe(30);
    // The control: the operator sees ada's 30 and never the connection's later 40 — the journal's
    // pool never touched the primary, so 30 above is the scope narrowing and not a missing delta.
    expect(await heightVia(base, "op-token")).toBe(30);
    expect((await mutateHeight(base, token, 41)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(41);
  });
});
