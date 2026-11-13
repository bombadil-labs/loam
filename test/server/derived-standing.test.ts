import { describe, expect, it } from "vitest";
import {
  closeAll,
  connect,
  connectionServer,
  grantOf,
  OPERATOR,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { readRegistrations } from "../../src/gateway/registration.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { withStamp } from "../../src/gateway/stamp.js";

const envelope = (name: string, prop = "note", roots = [`${name}:1`]): unknown => ({
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
  schema: {
    props: { [prop]: { pick: { order: { byTimestamp: "desc" } } } },
    default: { pick: { order: { byTimestamp: "desc" } } },
  },
  roots,
  writable: [prop],
});

const SLOW = 60_000;

const register = (base: string, bearer: string, body: unknown): Promise<Response> =>
  fetch(`${base}/default/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });

const gql = async (
  base: string,
  bearer: string,
  query: string,
): Promise<{ data?: unknown; errors?: string[] }> =>
  (await (
    await fetch(`${base}/default/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ query }),
    })
  ).json()) as { data?: unknown; errors?: string[] };

const serves = async (base: string, bearer: string, field: string): Promise<boolean> => {
  const res = await gql(base, bearer, `{ ${field}(entity: "x:1") { _entity } }`);
  if ((res.errors ?? []).length === 0) return true;
  expect(res.errors!.join(" ")).toMatch(new RegExp(`Cannot query field "${field}"`));
  return false;
};

const lensesIn = (gw: Gateway): string[] =>
  readRegistrations(gw.reactor, gw.validityNow(), gw.operatorAuthor).map(
    (r) => r.lensName ?? r.hyperschema.name,
  );
const pools = (gw: Gateway): Gateway[] =>
  [...gw.connectionInboxes.values()]
    .map((c) => c.gateway)
    .filter((g): g is Gateway => g !== undefined);

describe("§58 position 2 — the binding is the register grant, and the law serves only its container", () => {
  it("registers with NO grant; the law is in the pool and served to the connection alone", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const bea = await connect(base, "bea", "journal");

    const res = await register(base, ada, envelope("ada:journal:log"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bound: boolean }).bound).toBe(true);

    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");

    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, bea, "ada_journal_log")).toBe(false);
    await closeAll();
  });

  it("writes through its own lens into its pool, and reads it back — one position for all three", async () => {
    const { base, gateway, connectorsHome } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    const wrote = await gql(
      base,
      ada,
      `mutation { ada_journal_log(entity: "ada:journal:log:1", note: "first") { note } }`,
    );
    expect(wrote.errors).toBeUndefined();
    const read = await gql(base, ada, `{ ada_journal_log(entity: "ada:journal:log:1") { note } }`);
    expect((read.data as { ada_journal_log: { note: string } }).ada_journal_log.note).toBe("first");
    const inPrimary = [...gateway.reactor.snapshot()].some((d) =>
      JSON.stringify(d).includes('"first"'),
    );
    expect(inPrimary).toBe(false);
    const inPool = pools(gateway).some((p) =>
      [...p.reactor.snapshot()].some((d) => JSON.stringify(d).includes('"first"')),
    );
    expect(inPool).toBe(true);
    const claim = pools(gateway)
      .flatMap((p) => [...p.reactor.snapshot()])
      .find((d) => JSON.stringify(d).includes('"first"'))!;
    expect(claim.claims.author).toBe(authorForSeed(grantOf(connectorsHome, "ada").actorSeed));
    expect(claim.claims.author).not.toBe(gateway.operatorAuthor);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    await closeAll();
  });

  it("refuses every name outside the fence, INCLUDING the container's own bare name", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const outside = ["ada:other:log", "ada:journalx:log", "ada:journal", "log", "ada"];
    for (const name of outside) {
      expect((await register(base, ada, envelope(name))).status, `expected ${name} refused`).toBe(
        403,
      );
    }
    const everywhere = [...lensesIn(gateway), ...pools(gateway).flatMap(lensesIn)];
    for (const name of outside) expect(everywhere).not.toContain(name);
    await closeAll();
  });

  it("a lens over ground the connection cannot read answers it null, and is never served to the operator", async () => {
    const { base, gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        {
          ...gateway.stamp(),
          author: gateway.operatorAuthor!,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "vault:1", context: "secret" } },
            },
            { role: "value", target: { kind: "primitive", value: "THE-SECRET" } },
          ],
        },
        OPERATOR_SEED,
      ),
    ]);
    const ada = await connect(base, "ada", "journal");
    expect(
      (await register(base, ada, envelope("ada:journal:peek", "secret", ["vault:1"]))).status,
    ).toBe(200);

    expect(await serves(base, "op-token", "ada_journal_peek")).toBe(false);
    const mine = await gql(base, ada, `{ ada_journal_peek(entity: "vault:1") { secret } }`);
    expect(mine.errors).toBeUndefined();
    expect(
      (mine.data as { ada_journal_peek: { secret: unknown } }).ada_journal_peek.secret,
    ).toBeNull();
    await gateway.append([
      observed(FERN, "height", 30, gateway.stamp(authorForSeed(OPERATOR_SEED)), OPERATOR_SEED),
    ]);
    const theirs = await gql(base, "op-token", `{ plant(entity: "${FERN}") { height } }`);
    expect((theirs.data as { plant: { height: number } }).plant.height).toBe(30);
    await closeAll();
  });

  it("the FOLD fences all three names, for law that reached a pool another way", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:kept"))).status).toBe(200);
    const pool = pools(gateway)[0]!;
    const named = (name: string) => ({ ...PLANT_POLICY, name });

    await pool.publishRegistration(
      { ...PLANT, name: "ada:other:program" },
      named("ada:other:program"),
      [FERN],
    );
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:inside" },
      named("ada:other:reading"),
      [FERN],
    );
    await pool.publishRegistration(
      { ...PLANT, name: "ada:other:program2" },
      named("ada:journal:reading2"),
      [FERN],
    );
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:ent" },
      named("ada:journal:ent"),
      [FERN],
      undefined,
      "hyperschema:ada:journal:elsewhere",
    );
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:both" },
      named("ada:journal:both"),
      [FERN],
    );
    expect(lensesIn(pool)).toEqual(
      expect.arrayContaining(["ada:other:program", "ada:other:reading", "ada:journal:both"]),
    );

    expect(await serves(base, ada, "ada_journal_kept")).toBe(true);
    expect(await serves(base, ada, "ada_journal_both")).toBe(true);
    expect(await serves(base, ada, "ada_other_program")).toBe(false);
    expect(await serves(base, ada, "ada_other_reading")).toBe(false);
    expect(await serves(base, ada, "ada_journal_reading2")).toBe(false);
    expect(await serves(base, ada, "ada_journal_ent")).toBe(false);
    for (const f of [
      "ada_journal_kept",
      "ada_journal_both",
      "ada_other_program",
      "ada_other_reading",
    ]) {
      expect(await serves(base, "op-token", f)).toBe(false);
    }
    await closeAll();
  });

  it("a dropped pool's law serves nobody afterwards, and the operator's law is untouched", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);

    const [name] = [...gateway.connectionInboxes.keys()];
    await gateway.connectionInboxes.get(name!)!.drop();
    expect(gateway.connectionInboxes.size).toBe(0);

    const again = await connect(base, "ada", "journal");
    expect(await serves(base, again, "ada_journal_log")).toBe(false);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, "op-token", "plant")).toBe(true);
    await closeAll();
  });

  it("a pool lens that collides with the root's law is refused by the container fold, and the door SAYS so", async () => {
    const { base, gateway } = await connectionServer();
    const root = await register(base, "op-token", envelope("ada_journal_log"));
    expect(root.status).toBe(200);
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, envelope("ada:journal:log"));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { bound: boolean; reason?: string };
    expect(outcome.bound).toBe(false);
    expect(outcome.reason).toMatch(/ada_journal_log/);
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(true);
    expect(lensesIn(gateway)).toContain("ada_journal_log");
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    await closeAll();
  });

  it("a root lens spelled EXACTLY the same refuses the pool's, and the door reports THIS pool's row", async () => {
    const { base } = await connectionServer();
    expect((await register(base, "op-token", envelope("ada:journal:log", "rootprop"))).status).toBe(
      200,
    );
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, envelope("ada:journal:log", "note"));
    expect(res.status).toBe(200);
    const outcome = (await res.json()) as { bound: boolean; reason?: string };
    expect(outcome.bound).toBe(false);
    expect(outcome.reason).toMatch(/ada_journal_log/);
    const mine = await gql(base, ada, `{ ada_journal_log(entity: "ada:journal:log:1") { note } }`);
    expect((mine.errors ?? []).join(" ")).toMatch(/Cannot query field "note"/);
    const theirs = await gql(
      base,
      "op-token",
      `{ ada_journal_log(entity: "ada:journal:log:1") { rootprop } }`,
    );
    expect(theirs.errors).toBeUndefined();
    await closeAll();
  });

  it(
    "a grant does not widen a bound connection's registration fence",
    async () => {
      const { base, gateway, connectorsHome } = await connectionServer();
      const ada = await connect(base, "ada", "journal");
      const key = authorForSeed(grantOf(connectorsHome, "ada").actorSeed);
      await gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) =>
            grantClaims(STORE_ENTITY, key, "register", OPERATOR, t, "zed:"),
          ),
          OPERATOR_SEED,
        ),
      ]);
      const who = (await (
        await fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${ada}` } })
      ).json()) as { registerPrefixes: string[] };
      expect(who.registerPrefixes).toEqual(["ada:journal:"]);

      const granted = await register(base, ada, envelope("zed:thing"));
      expect(granted.status).toBe(403);
      expect(lensesIn(gateway)).not.toContain("zed:thing");
      expect(pools(gateway).flatMap(lensesIn)).not.toContain("zed:thing");
      expect(await serves(base, "op-token", "zed_thing")).toBe(false);
      expect(await serves(base, ada, "zed_thing")).toBe(false);
      expect((await register(base, ada, envelope("ada:journal:own"))).status).toBe(200);
      expect(lensesIn(gateway)).not.toContain("ada:journal:own");
      expect(await serves(base, "op-token", "ada_journal_own")).toBe(false);
      await closeAll();
    },
    SLOW,
  );

  it(
    "a pair split across the fence and a grant is refused",
    async () => {
      const { base, gateway, connectorsHome } = await connectionServer();
      const ada = await connect(base, "ada", "journal");
      const key = authorForSeed(grantOf(connectorsHome, "ada").actorSeed);
      await gateway.append([
        signClaims(
          withStamp(gateway.stamp(), (t) =>
            grantClaims(STORE_ENTITY, key, "register", OPERATOR, t, "zed:"),
          ),
          OPERATOR_SEED,
        ),
      ]);
      const bea = await connect(base, "bea", "journal");
      for (const [program, reading] of [
        ["ada:journal:p1", "zed:r1"],
        ["zed:p2", "ada:journal:r2"],
      ] as const) {
        const mixed = await register(base, ada, {
          ...(envelope(program) as Record<string, unknown>),
          schema: {
            name: reading,
            props: { note: { pick: { order: { byTimestamp: "desc" } } } },
            default: { pick: { order: { byTimestamp: "desc" } } },
          },
        });
        expect(mixed.status, `${program} / ${reading}`).toBe(403);
      }
      const everywhere = [...lensesIn(gateway), ...pools(gateway).flatMap(lensesIn)];
      for (const name of ["ada:journal:p1", "zed:r1", "zed:p2", "ada:journal:r2"]) {
        expect(everywhere).not.toContain(name);
      }
      expect(await serves(base, "op-token", "ada_journal_r2")).toBe(false);
      expect(await serves(base, bea, "ada_journal_r2")).toBe(false);
      await closeAll();
    },
    SLOW,
  );

  it("a PLAIN holder of two grants may still pair a program under one with a reading under the other", async () => {
    const TWO_SEED = "d4".repeat(32);
    const { base, gateway } = await connectionServer({
      tokens: { "two-token": { actor: TWO_SEED } },
    });
    const key = authorForSeed(TWO_SEED);
    await gateway.append([
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          grantClaims(STORE_ENTITY, key, "register", OPERATOR, t, "zed:"),
        ),
        OPERATOR_SEED,
      ),
      signClaims(
        withStamp(gateway.stamp(), (t) =>
          grantClaims(STORE_ENTITY, key, "register", OPERATOR, t, "yon:"),
        ),
        OPERATOR_SEED,
      ),
    ]);
    const mixed = await register(base, "two-token", {
      ...(envelope("zed:p") as Record<string, unknown>),
      schema: {
        name: "yon:r",
        props: { note: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    });
    expect(mixed.status).toBe(200);
    expect(lensesIn(gateway)).toContain("yon:r");
    expect(await serves(base, "op-token", "yon_r")).toBe(true);
    await closeAll();
  });

  it("KNOWN LIMIT — a pool lens that expands into the ROOT's reading is refused at the door, by name", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, {
      ...(envelope("ada:journal:expander") as Record<string, unknown>),
      hyperschema: {
        name: "ada:journal:expander",
        alg: 1,
        body: {
          op: "expand",
          role: { exact: "grows" },
          schema: "Plant",
          reading: "Plant",
          in: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
      },
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/Plant/);
    expect(lensesIn(gateway)).not.toContain("ada:journal:expander");
    expect(pools(gateway).flatMap(lensesIn)).not.toContain("ada:journal:expander");
    await closeAll();
  });

  it("LISTS its own pool lens — the page's contexts come from the surface it is served", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:log"))).status).toBe(200);
    const wrote = await gql(
      base,
      ada,
      `mutation { ada_journal_log(entity: "ada:journal:log:1", note: "listed") { note } }`,
    );
    expect(wrote.errors).toBeUndefined();
    const page = await gql(base, ada, `{ ada_journal_logs(limit: 5) { _entity } }`);
    expect(page.errors).toBeUndefined();
    expect(
      (page.data as { ada_journal_logs: { _entity: string }[] }).ada_journal_logs.map(
        (n) => n._entity,
      ),
    ).toEqual(["ada:journal:log:1"]);
    expect(await serves(base, "op-token", "ada_journal_logs")).toBe(false);
    await closeAll();
  });

  it("binds a dependent lens whose dependency was EVOLVED later — the dependent's first claim does not move", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:a"))).status).toBe(200);
    const b = {
      ...(envelope("ada:journal:b") as Record<string, unknown>),
      hyperschema: {
        name: "ada:journal:b",
        alg: 1,
        body: {
          op: "expand",
          role: { exact: "grows" },
          schema: "ada:journal:a",
          reading: "ada:journal:a",
          in: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
      },
    };
    const first = await register(base, ada, b);
    expect(first.status).toBe(200);
    expect(((await first.json()) as { bound: boolean }).bound).toBe(true);
    expect(await serves(base, ada, "ada_journal_b")).toBe(true);
    expect((await register(base, ada, envelope("ada:journal:a", "note2"))).status).toBe(200);
    expect(await serves(base, ada, "ada_journal_a")).toBe(true);
    expect(await serves(base, ada, "ada_journal_b")).toBe(true);
    await closeAll();
  });

  it("binds a lens EVOLVED to depend on one staked after it — the fold runs to a fixpoint", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:b"))).status).toBe(200);
    expect((await register(base, ada, envelope("ada:journal:a"))).status).toBe(200);
    const evolved = await register(base, ada, {
      ...(envelope("ada:journal:b") as Record<string, unknown>),
      hyperschema: {
        name: "ada:journal:b",
        alg: 1,
        body: {
          op: "expand",
          role: { exact: "grows" },
          schema: "ada:journal:a",
          reading: "ada:journal:a",
          in: {
            op: "group",
            key: "byTargetContext",
            in: {
              op: "select",
              pred: { hasPointer: { targetEntity: { var: "root" } } },
              in: { op: "mask", policy: "drop", in: "input" },
            },
          },
        },
      },
    });
    expect(evolved.status).toBe(200);
    expect(((await evolved.json()) as { bound: boolean }).bound).toBe(true);
    expect(await serves(base, ada, "ada_journal_b")).toBe(true);
    expect(await serves(base, ada, "ada_journal_a")).toBe(true);
    await closeAll();
  });

  it("refuses NUL in a READING name at the door and at the fold", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const atDoor = await register(base, ada, {
      ...(envelope("ada:journal:nul") as Record<string, unknown>),
      schema: {
        name: "ada:journal:n\u0000l",
        props: { note: { pick: { order: { byTimestamp: "desc" } } } },
        default: { pick: { order: { byTimestamp: "desc" } } },
      },
    });
    expect(atDoor.status).toBe(403);
    const pool = pools(gateway)[0]!;
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:nulled" },
      { ...PLANT_POLICY, name: "ada:journal:nu\u0000lled" },
      [FERN],
    );
    expect(lensesIn(pool)).toContain("ada:journal:nu\u0000lled");
    expect(
      gateway
        .boundSurface({
          container: "ada:journal",
          inbox: [...gateway.connectionInboxes.keys()][0]!,
        })
        .registered.map((r) => r.lensName ?? r.hyperschema.name),
    ).not.toContain("ada:journal:nu\u0000lled");
    await closeAll();
  });

  it("the MCP road takes the same sink, fence and wall", async () => {
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const call = async (name: string) => {
      const res = await fetch(`${base}/default/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ada}` },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "loam_register", arguments: envelope(name) },
        }),
      });
      const body = (await res.json()) as {
        result: { content: { text: string }[]; isError?: boolean };
      };
      return body.result;
    };
    const ok = await call("ada:journal:tool");
    expect(ok.isError).not.toBe(true);
    expect((JSON.parse(ok.content[0]!.text) as { bound: boolean }).bound).toBe(true);
    expect(lensesIn(gateway)).not.toContain("ada:journal:tool");
    expect(await serves(base, ada, "ada_journal_tool")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_tool")).toBe(false);

    const refused = await call("ada:other:tool");
    expect(refused.isError).toBe(true);
    await closeAll();
  });

  it("whoami reports the fence the door applies", async () => {
    const { base } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    const who = (await (
      await fetch(`${base}/default/whoami`, { headers: { authorization: `Bearer ${ada}` } })
    ).json()) as { registerPrefixes: string[] };
    expect(who.registerPrefixes).toContain("ada:journal:");
    await closeAll();
  });
});
