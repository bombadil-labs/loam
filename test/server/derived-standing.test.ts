// T263 — DERIVED STANDING: a bound connection registers law under its own container path, and
// THAT LAW SERVES ONLY ITS CONTAINER (SPEC §58 position 2; Myk's ruling, 2026-09-03).
//
// Two fences and one wall, and each has a case below. The fence at the DOOR: bound to `C`, a
// connection may name law under `C:` — the path AND ITS COLON — and nothing else. The fence at the
// FOLD: the same three names (program, reading, entity) are checked again for law that reached a
// pool by any other road. The WALL: a connection's law never enters the root fold, so it is served
// to the connection and to nobody else — not the operator, not a sibling container's connection,
// not the public door. Before this wall the operator was served a connection's lens evaluated over
// the operator's own ground (measured: `secret: "THE-SECRET"`).
//
// Railed at BOTH LEVELS: which reactor holds the registration delta (the pool's, never the
// primary's) AND what each door serves — asked as "does the surface CARRY the field", matched on
// GraphQL's own "Cannot query field", so no other error can pass for "not served".
//
// NOT HERE, and said so rather than padded: (a) a restart — the pools re-attach through S1's
// `resumeInboxesImpl`, which S1 railed, and this fold is a pure function over the attached pools,
// so what a boot needs is exactly what S1 proves; (b) `bound:false` from the container trial for a
// candidate the POOL accepted — every deterministic refusal I could construct is refused earlier by
// the parser or the fence, so a rail for it would have been hollow.

//
// RAILS-RED on origin/main, this file copied in: 8 red, 1 green — 9 cases. The green one is the
// door-fence case, and it is a CONTROL: on main every one of those names is refused because a
// connection may register nothing at all. It pins that the fence did not widen; it proves nothing
// about the fence, and says so here rather than padding the count.
//
// REVERT PROBES, MEASURED against this file as it stands — 9 cases. Re-measure when you add one.
//   the binding grants no register fence                        → 8 red, 1 green
//   the fence drops the COLON                                   → 2 red, 7 green
//   a bound registration publishes to the primary               → 7 red, 2 green
//   the FOLD fences none of its three names                     → 1 red, 8 green
//   inbox law back in the ROOT fold, with a root refold         → 6 red, 3 green
//   the query door ignores the binding                          → 6 red, 3 green
//   the door reports the pool's answer, not the container's     → 1 red, 8 green
//   whoami re-derives standing beside the door                  → 1 red, 8 green
// The fifth is the one Myk's ruling exists to prevent, restored WHOLE — the loop alone, without
// the refold that carried it up, leaves every case green, which is how an earlier draft of these
// probes misread a hollow rail as a sound one.

import { describe, expect, it } from "vitest";
import {
  closeAll,
  connect,
  connectionServer,
  OPERATOR_SEED,
} from "../helpers/connection-fixture.js";
import { readRegistrations } from "../../src/gateway/registration.js";
import type { Gateway } from "../../src/gateway/gateway.js";
import { PLANT, PLANT_POLICY } from "../gateway/fixtures.js";
import { FERN, observed } from "../spike/garden.js";
import { signClaims } from "@bombadil/rhizomatic";

/** A minimal, valid registration for one lens name — the canonical entity program. */
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

/** Does this door's surface CARRY the field? Only GraphQL's own absence sentence counts as "no". */
const serves = async (base: string, bearer: string, field: string): Promise<boolean> => {
  const res = await gql(base, bearer, `{ ${field}(entity: "x:1") { _entity } }`);
  if ((res.errors ?? []).length === 0) return true;
  expect(res.errors!.join(" ")).toMatch(new RegExp(`Cannot query field "${field}"`));
  return false;
};

/** The lens names a reactor holds — `lensName` falling back to the hyperschema's. */
const lensesIn = (gw: Gateway): string[] =>
  readRegistrations(gw.reactor, gw.operatorAuthor).map((r) => r.lensName ?? r.hyperschema.name);
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

    // DELTA LEVEL: in the connection's pool, never in the primary.
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");

    // OBJECT LEVEL, three doors. The connection's surface carries it. The operator's does not —
    // the root fold never saw it. A sibling home's connection does not either.
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, bea, "ada_journal_log")).toBe(false);
    await closeAll();
  });

  it("writes through its own lens into its pool, and reads it back — one position for all three", async () => {
    // Register, write, read: the same container position governs each. The generated mutation
    // for a pool lens is served on the connection's surface and lands through `sinkFor`, in the
    // pool, signed by the connection's key — never in the primary, never as the operator.
    const { base, gateway } = await connectionServer();
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
    // DELTA LEVEL: the claim is in the pool, not the primary, and the operator's door has no field.
    const inPrimary = [...gateway.reactor.snapshot()].some((d) =>
      JSON.stringify(d).includes('"first"'),
    );
    expect(inPrimary).toBe(false);
    const inPool = pools(gateway).some((p) =>
      [...p.reactor.snapshot()].some((d) => JSON.stringify(d).includes('"first"')),
    );
    expect(inPool).toBe(true);
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
    // THE MEASURED HOLE. Before the wall, this lens was served to the operator, evaluated over the
    // operator's own ground, and answered "THE-SECRET" — for a connection holding no grant at all.
    const { base, gateway } = await connectionServer();
    await gateway.append([
      signClaims(
        {
          timestamp: gateway.nextTimestamp(),
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

    // The operator's surface does not carry it.
    expect(await serves(base, "op-token", "ada_journal_peek")).toBe(false);
    // The connection's does — and resolves it over the CONNECTION'S scope, where vault:1 is not.
    const mine = await gql(base, ada, `{ ada_journal_peek(entity: "vault:1") { secret } }`);
    expect(mine.errors).toBeUndefined();
    expect(
      (mine.data as { ada_journal_peek: { secret: unknown } }).ada_journal_peek.secret,
    ).toBeNull();
    // Two-sided: the operator's own law over the operator's own ground is untouched.
    await gateway.append([observed(FERN, "height", 30, gateway.nextTimestamp(), OPERATOR_SEED)]);
    const theirs = await gql(base, "op-token", `{ plant(entity: "${FERN}") { height } }`);
    expect((theirs.data as { plant: { height: number } }).plant.height).toBe(30);
    await closeAll();
  });

  it("the FOLD fences all three names, for law that reached a pool another way", async () => {
    // The door is not the only road into a pool. Publish straight onto it — no fence, no
    // standing — and see what the connection's surface carries.
    const { base, gateway } = await connectionServer();
    const ada = await connect(base, "ada", "journal");
    expect((await register(base, ada, envelope("ada:journal:kept"))).status).toBe(200);
    const pool = pools(gateway)[0]!;
    const named = (name: string) => ({ ...PLANT_POLICY, name });

    // (a) the PROGRAM name outside the container
    await pool.publishRegistration(
      { ...PLANT, name: "ada:other:program" },
      named("ada:other:program"),
      [FERN],
    );
    // (b) the program inside, the READING outside — the second name the door fences
    await pool.publishRegistration(
      { ...PLANT, name: "ada:journal:inside" },
      named("ada:other:reading"),
      [FERN],
    );
    // (c) both inside: served
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
    // And none of it ever reaches the root.
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
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false); // never at root

    const [name] = [...gateway.connectionInboxes.keys()];
    await gateway.connectionInboxes.get(name!)!.drop();
    expect(gateway.connectionInboxes.size).toBe(0);

    // A fresh binding in the same container is served a surface WITHOUT the dropped law...
    const again = await connect(base, "ada", "journal");
    expect(await serves(base, again, "ada_journal_log")).toBe(false);
    // ...the operator still is not, and the operator's own law still serves (the bystander).
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(false);
    expect(await serves(base, "op-token", "plant")).toBe(true);
    await closeAll();
  });

  it("a pool lens that collides with the root's law is refused by the container fold, and the door SAYS so", async () => {
    // The pool's own trial cannot see the root's law, so the pool binds `ada:journal:log`
    // happily. The container's fold trials it BESIDE the root's rows — and the operator already
    // serves a lens whose GraphQL name is `ada_journal_log`. The nearer ground never displaces the
    // operator's law, and the door must report the fold's answer, not the pool's (H7).
    const { base, gateway } = await connectionServer();
    const root = await register(base, "op-token", envelope("ada_journal_log")); // the operator is unfenced
    expect(root.status).toBe(200);
    const ada = await connect(base, "ada", "journal");
    const res = await register(base, ada, envelope("ada:journal:log"));
    expect(res.status).toBe(200); // written — the deltas are down in the pool either way
    const outcome = (await res.json()) as { bound: boolean; reason?: string };
    expect(outcome.bound).toBe(false);
    expect(outcome.reason).toMatch(/ada_journal_log/);
    // What the connection's surface carries under that field is the OPERATOR'S lens, still.
    expect(pools(gateway).flatMap(lensesIn)).toContain("ada:journal:log");
    expect(await serves(base, ada, "ada_journal_log")).toBe(true);
    expect(await serves(base, "op-token", "ada_journal_log")).toBe(true);
    expect(lensesIn(gateway)).toContain("ada_journal_log");
    expect(lensesIn(gateway)).not.toContain("ada:journal:log");
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
