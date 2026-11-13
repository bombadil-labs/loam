import { afterEach, describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { readUserSeed } from "../../src/cli/config.js";
import { containerClaims } from "../../src/gateway/container-law.js";
import { FERN, observed } from "../spike/garden.js";
import {
  OPERATOR,
  OPERATOR_SEED,
  closeAll,
  connect,
  connectionServer,
  graphql,
  grantOf,
  heightVia,
  mutateHeight,
} from "../helpers/connection-fixture.js";
import { withStamp, type Stamp } from "../../src/gateway/stamp.js";

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
    await gateway.append([
      observed(
        FERN,
        "height",
        30,
        gateway.stamp(authorForSeed(seedOf(usersHome, "ada"))),
        seedOf(usersHome, "ada"),
      ),
    ]);
    await gateway.append([observed(FERN, "height", 99, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
    expect(await heightVia(base, token)).toBe(30);
    expect(await heightVia(base, "op-token")).toBe(99);
    expect((await mutateHeight(base, token, 31)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(31);
    expect(await heightVia(base, "op-token")).toBe(99);
  });

  it("the listing pages the scope only; the operator's listing sees the whole store", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    await gateway.append([
      observed(
        FERN,
        "height",
        30,
        gateway.stamp(authorForSeed(seedOf(usersHome, "ada"))),
        seedOf(usersHome, "ada"),
      ),
    ]);
    await gateway.append([observed(OAK, "height", 1, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
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
      observed(
        FERN,
        "height",
        30,
        gateway.stamp(authorForSeed(seedOf(usersHome, "ada"))),
        seedOf(usersHome, "ada"),
      ),
    ]);
    expect((await mutateHeight(base, token, 31)).status).toBe(200);
    await gateway.append([observed(FERN, "height", 99, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
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
    expect(await rest("op-token", at)).toBe(99);
  });

  it("the MCP query tool reads the scope", async () => {
    const { base, gateway, usersHome } = await connectionServer();
    const token = await connect(base, "ada", "journal");
    await gateway.append([
      observed(
        FERN,
        "height",
        30,
        gateway.stamp(authorForSeed(seedOf(usersHome, "ada"))),
        seedOf(usersHome, "ada"),
      ),
    ]);
    await gateway.append([observed(FERN, "height", 99, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
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
    await gateway.append([
      observed(
        FERN,
        "height",
        30,
        gateway.stamp(authorForSeed(seedOf(usersHome, "ada"))),
        seedOf(usersHome, "ada"),
      ),
    ]);
    expect((await mutateHeight(base, token, 40)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(40);

    await connect(base, "ada", "other");
    expect(grantOf(connectorsHome, "ada").container).toBe("ada:other");
    expect(await heightVia(base, token)).toBe(30);
    expect(await heightVia(base, "op-token")).toBe(30);
    expect((await mutateHeight(base, token, 41)).status).toBe(200);
    expect(await heightVia(base, token)).toBe(41);
  });

  const room = (gateway: { stamp(): Stamp }, container: string, parent: string) =>
    signClaims(
      withStamp(gateway.stamp(), (t) =>
        containerClaims(
          {
            container,
            parent,
            trust: "curated",
            posture: "shared",
            membership: {
              op: "select",
              pred: { match: { field: "author", cmp: "eq", const: OPERATOR } },
              in: "input",
            },
          },
          OPERATOR,
          t,
        ),
      ),
      OPERATOR_SEED,
    );

  it("a room BENEATH the workspace resolves; a room beside it does not", async () => {
    const { base, gateway } = await connectionServer();
    const token = await connect(base, "ada", "workspace");
    await gateway.append([
      room(gateway, "ada:workspace:notes", "ada:workspace"),
      room(gateway, "ada:elsewhere", "ada"),
    ]);
    await gateway.append([observed(FERN, "height", 7, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
    expect(await heightVia(base, token)).toBe(7);

    await gateway.append([observed(MOSS, "height", 99, gateway.stamp(OPERATOR), OPERATOR_SEED)]);
    const res = await graphql(base, token, `{ plant(entity: "${MOSS}") { height } }`);
    const body = (await res.json()) as { data?: { plant?: { height?: unknown } } };
    expect(body.data?.plant?.height ?? null).toBe(99);
    expect(await heightVia(base, "op-token")).toBe(7);
  });

  it("an unreachable room faults the whole workspace read rather than shrinking it", async () => {
    const { base, gateway } = await connectionServer();
    const token = await connect(base, "ada", "workspace");
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          containerClaims(
            {
              container: "ada:workspace:vault",
              parent: "ada:workspace",
              trust: "curated",
              posture: "separate",
            },
            OPERATOR,
            t,
          ),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const res = await graphql(base, token, `{ plant(entity: "${FERN}") { height } }`);
    const body = (await res.json()) as { errors?: string[] };
    expect(body.errors?.join(" ")).toMatch(/not attached|cannot be read/);
    expect(await heightVia(base, "op-token")).toBeNull();
  });
});
