// T246 phase A — the stock shelf learns refs (working spec §52, criteria a–f).
//
// `event.attending` and `org.members` become DECLARED references (§51): each serves its typed
// link/unlink pair, offers no primitive argument, and leaves `writable` — the refs declaration is
// the write opening, for the §51 verbs and for the §14 `link<Type>` verb alike. Legacy primitive
// values keep resolving in the mixed array beside real edges. `person.follows` still teaches the
// fossil path ON PURPOSE (phase A honesty): a frozen rail owns it until the phase B ceremony.
//
// TWO LEVELS, as P3 requires. Object level: the real CLI — init, register, serve, GraphQL over
// HTTP — because the introspected surface is the cold client's entire documentation. Delta level:
// gateway fixtures over MemoryBackend, where the authored pointers and the negation record are
// inspectable.
//
// Deliberately NOT asserted, each a named gap rather than a silent one:
//   - `severEvent(field: "attending")` refuses read-only in phase A — the §51 unlink pair is the
//     retraction door for a refs prop, and widening §14 sever the way link widened is a behavior
//     decision, not a repair;
//   - the CLI's dependency-install path forwards `refs` (cli.ts), but no shelf entry with refs is
//     any other entry's dependency today, so no public seam can drive that argument; the first
//     refs-carrying dependency earns the rail;
//   - the §51 generic machinery (reciprocal folds, undeclared-reciprocal warnings, _claim parity)
//     is T245's frozen rail (test/gateway/edge-mutations.test.ts), not re-pinned here.
// All fixture stores live in this file's own mkdtemp homes or MemoryBackends; nothing touches a
// real ~/.loam.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { entityGatherJson, expandedGatherJson } from "../../src/gateway/gather.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { installOrder } from "../../src/stock/graph.js";
import { stockSchema } from "../../src/stock/index.js";
import { observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 30_000 }); // real HTTP servers and sqlite stores, twice over

// ── the CLI half: a real home, a real serve, the introspected door ──────────────────────────────

let home: string;
const out: string[] = [];
const err: string[] = [];
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "loam-stock-refs-"));
  out.length = 0;
  err.length = 0;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function serveDetached(
  args: readonly string[],
): Promise<{ url: string; close(): Promise<void> }> {
  const handle = await run(["serve", "--http", ...args], io(), { detach: true });
  if (typeof handle === "number") throw new Error("serve should return a running handle");
  return handle;
}

const gql = async (
  url: string,
  query: string,
): Promise<{ data?: Record<string, unknown>; errors?: unknown[] }> => {
  const res = await fetch(`${url}/default/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer t" },
    body: JSON.stringify({ query }),
  });
  return (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
};

// Hand-rendered type strings, so the expectations below stay literals.
interface TypeRefJson {
  kind: string;
  name: string | null;
  ofType?: TypeRefJson | null;
}
const renderType = (t: TypeRefJson): string =>
  t.kind === "NON_NULL"
    ? `${renderType(t.ofType!)}!`
    : t.kind === "LIST"
      ? `[${renderType(t.ofType!)}]`
      : (t.name ?? "?");

const INTROSPECT = `{
  mutation: __type(name: "Mutation") {
    fields {
      name
      description
      args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
    }
  }
}`;

async function mutationSurface(
  url: string,
): Promise<Map<string, { description: string | null; args: Record<string, string> }>> {
  const result = await gql(url, INTROSPECT);
  expect(result.errors, JSON.stringify(result.errors)).toBeUndefined();
  const data = result.data as {
    mutation: {
      fields: {
        name: string;
        description: string | null;
        args: { name: string; type: TypeRefJson }[];
      }[];
    };
  };
  return new Map(
    data.mutation.fields.map((f) => [
      f.name,
      {
        description: f.description,
        args: Object.fromEntries(f.args.map((a) => [a.name, renderType(a.type)])),
      },
    ]),
  );
}

describe("§52 (a) — the introspected shelf teaches the truth, and phase A is honest about follows", () => {
  it("event and org serve typed pairs with no primitive argument; person still offers follows", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "event", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);

    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      const fields = await mutationSurface(handle.url);

      // The typed pairs, ID! on both args — the §51 shape, now on the shelf.
      for (const pair of [
        "linkevent_attending",
        "unlinkevent_attending",
        "linkorg_members",
        "unlinkorg_members",
      ]) {
        expect(fields.get(pair), pair).toBeDefined();
        expect(fields.get(pair)!.args, pair).toEqual({ entity: "ID!", target: "ID!" });
      }

      // The primitive argument is GONE — exact arg sets, so a resurrected fossil arg fails here.
      expect(fields.get("event")!.args).toEqual({
        entity: "ID!",
        title: "PrimitiveValue",
        startsAt: "PrimitiveValue",
        endsAt: "PrimitiveValue",
        location: "PrimitiveValue",
        notes: "PrimitiveValue",
      });
      expect(fields.get("org")!.args).toEqual({
        entity: "ID!",
        name: "PrimitiveValue",
        description: "PrimitiveValue",
        website: "PrimitiveValue",
      });
      // ...and the base mutation's description names the reference, not "read-only" (the §51
      // typing that separates a reference prop from a prop nobody opened).
      expect(fields.get("event")!.description).toContain("Reference props");
      expect(fields.get("event")!.description).toContain("attending");
      expect(fields.get("event")!.description).not.toMatch(/Read-only here.*attending/);

      // PHASE A HONESTY: person.follows still writes as a primitive, and no pair serves for it.
      expect(fields.get("person")!.args).toEqual({
        entity: "ID!",
        name: "PrimitiveValue",
        bio: "PrimitiveValue",
        email: "PrimitiveValue",
        follows: "PrimitiveValue",
      });
      expect(fields.has("linkperson_follows")).toBe(false);
      expect(fields.has("unlinkperson_follows")).toBe(false);
    } finally {
      await handle.close();
    }
  });
});

describe("§52 (b) — the §14 link verb is refs-aware, two-sided", () => {
  it("linkOrg links members with members OFF writable; a non-refs unopened field still refuses", async () => {
    // The premise, pinned in the rail itself so it cannot pass by the old writable opening:
    const org = stockSchema("org")!.registration as { writable: string[] };
    expect(
      org.writable,
      "members must be off writable for this rail to mean anything",
    ).not.toContain("members");

    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);
    // A bespoke lens carrying BOTH shapes at once: `members` declared in refs, `rivals` a plain
    // prop deliberately left out of `writable`. Same §14 verb, opposite verdicts.
    const team = join(home, "team.json");
    writeFileSync(
      team,
      JSON.stringify({
        hyperschema: {
          name: "Team",
          alg: 1,
          body: expandedGatherJson({
            role: "members",
            schema: "ShallowPerson",
            reading: "ShallowPerson",
          }),
        },
        schema: {
          name: "Team",
          alg: 1,
          props: {
            title: { pick: { order: { byTimestamp: "desc" } } },
            members: { all: { order: { byTimestamp: "asc" } } },
            rivals: { all: { order: { byTimestamp: "asc" } } },
          },
          default: { pick: { order: { byTimestamp: "desc" } } },
        },
        roots: [],
        writable: ["title"],
        refs: {
          members: { role: "members", reciprocal: { role: "memberOf", context: "memberOf" } },
        },
      }),
    );
    expect(await run(["register", team, "--home", home], io())).toBe(0);

    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      // Ada exists by name, so the nested resolution below has something to show.
      let res = await gql(
        handle.url,
        `mutation { person(entity: "person:ada", name: "Ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      // The refs-authorized side: the frozen depth rail's exact call, with members off writable.
      res = await gql(
        handle.url,
        `mutation { linkOrg(entity: "org:labs", field: "members", target: "person:ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      const read = await gql(handle.url, `{ org(entity: "org:labs") { members } }`);
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      const members = (read.data?.["org"] as { members: unknown[] }).members;
      expect(members).toMatchObject([{ name: "Ada" }]);

      // The writable-gated side: same verb, a non-refs field nobody opened, refused with the §14
      // read-only voice — the refs awareness must not have deleted the gate.
      const refused = await gql(
        handle.url,
        `mutation { linkTeam(entity: "team:reds", field: "rivals", target: "team:blues") { title } }`,
      );
      expect(refused.errors?.join(" ")).toMatch(/"rivals" of Team is read-only/);
      // ...and the bespoke lens's own refs field links, proving the verdict tracked the
      // declaration rather than the lens.
      const linked = await gql(
        handle.url,
        `mutation { linkTeam(entity: "team:reds", field: "members", target: "person:ada") { members } }`,
      );
      expect(linked.errors, JSON.stringify(linked.errors)).toBeUndefined();
      expect((linked.data?.["linkTeam"] as { members: unknown[] }).members).toMatchObject([
        { name: "Ada" },
      ]);
    } finally {
      await handle.close();
    }
  });
});

describe("§52 (d) — COMPAT: a pre-retrofit primitive keeps resolving beside a fresh edge", () => {
  it("write under the OLD registration, republish the NEW one, and the mixed array holds both", async () => {
    await run(["init", "--home", home], io());

    // ACT 1 — the pre-§52 shelf, byte-shape: entityGather body, attending primitive-writable.
    // Hand-written rather than derived from the shelf (H10): this is yesterday's registration,
    // which the code under test no longer carries anywhere.
    const oldEvent = join(home, "old-event.json");
    const LATEST = { pick: { order: { byTimestamp: "desc" } } };
    const EVERY = { all: { order: { byTimestamp: "asc" } } };
    writeFileSync(
      oldEvent,
      JSON.stringify({
        hyperschema: { name: "Event", alg: 1, body: entityGatherJson() },
        schema: {
          name: "Event",
          alg: 1,
          props: {
            title: LATEST,
            startsAt: LATEST,
            endsAt: LATEST,
            location: LATEST,
            notes: LATEST,
            attending: EVERY,
          },
          default: LATEST,
        },
        roots: [],
        writable: ["title", "startsAt", "endsAt", "location", "notes", "attending"],
      }),
    );
    expect(await run(["register", oldEvent, "--home", home], io())).toBe(0);

    let handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      // The cold client's natural mistake, last week: a string into the primitive argument.
      const wrote = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", title: "Picnic", attending: "person:bob") { attending } }`,
      );
      expect(wrote.errors, JSON.stringify(wrote.errors)).toBeUndefined();
      expect((wrote.data?.["event"] as { attending: unknown }).attending).toEqual(["person:bob"]);
    } finally {
      await handle.close();
    }

    // ACT 2 — the upgrade: `--stock event` EVOLVES the same registration entity, closure and all.
    out.length = 0;
    err.length = 0;
    expect(await run(["register", "--stock", "event", "--home", home], io())).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/Event was already bound — this publish evolves it/);
    expect(err.join("\n")).not.toMatch(/does not bind/);

    handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      // The retrofitted surface: the primitive argument is gone from this door...
      const fossil = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", attending: "person:eve") { attending } }`,
      );
      expect(fossil.errors?.join(" ")).toMatch(/Unknown argument "attending"/);
      // ...while a plain prop beside it still writes (criterion e's two-sided door half).
      const title = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", title: "Spring picnic") { title } }`,
      );
      expect(title.errors, JSON.stringify(title.errors)).toBeUndefined();

      // A real link lands beside the legacy value.
      let res = await gql(
        handle.url,
        `mutation { shallowPerson(entity: "person:ada", name: "Ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      res = await gql(
        handle.url,
        `mutation { linkevent_attending(entity: "event:picnic", target: "person:ada") { attending } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      // THE MIXED ARRAY, two-sided: the legacy primitive (older, so first under `all` asc) AND
      // the linked nested ShallowPerson view, in one read through the evolved lens.
      const read = await gql(handle.url, `{ event(entity: "event:picnic") { title attending } }`);
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      const view = read.data?.["event"] as { title: string; attending: unknown[] };
      expect(view.title).toBe("Spring picnic");
      expect(view.attending).toHaveLength(2);
      expect(view.attending[0], "the legacy value, still a bare string").toBe("person:bob");
      expect(view.attending[1], "the edge, resolved shallow").toMatchObject({ name: "Ada" });
    } finally {
      await handle.close();
    }
  });
});

// ── the gateway half: delta-level assertions over a MemoryBackend ───────────────────────────────

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "e1".repeat(32);
const WRITER = authorForSeed(WRITER_SEED);
const SECOND_SEED = "e2".repeat(32);

const EVENT = "event:hike";
const MYK = "person:myk";

// The shelf's own bytes through the ordinary publish door, closure sinks-first — the same
// registrations `--stock` installs, minus the CLI.
async function publishStock(gw: Gateway, name: string): Promise<void> {
  for (const entry of installOrder(name)) {
    const input = parseRegistrationInput(structuredClone(entry.registration));
    const outcome = await gw.publishRegistration(
      input.hyperschema,
      input.schema,
      input.roots,
      undefined,
      input.entity,
      input.mutations,
      input.writable,
      input.resolvers,
      input.refs,
    );
    expect(outcome.bound, `stock ${entry.name} binds`).toBe(true);
  }
}

async function world(): Promise<{ gateway: Gateway; backend: MemoryBackend }> {
  const backend = new MemoryBackend();
  const gateway = await Gateway.open(backend, { seed: OPERATOR_SEED });
  await gateway.append([
    signClaims(grantClaims(STORE_ENTITY, WRITER, "write", OPERATOR, 9_001), OPERATOR_SEED),
    signClaims(
      grantClaims(STORE_ENTITY, authorForSeed(SECOND_SEED), "write", OPERATOR, 9_002),
      OPERATOR_SEED,
    ),
  ]);
  await publishStock(gateway, "event");
  return { gateway, backend };
}

const idsOf = async (backend: MemoryBackend): Promise<Set<string>> =>
  new Set((await backend.deltasSince(new Set())).map((d) => d.id));

async function freshDeltas(
  gateway: Gateway,
  backend: MemoryBackend,
  settled: ReadonlySet<string>,
): Promise<Delta[]> {
  await gateway.flush();
  return backend.deltasSince(settled);
}

// Pointers normalized for structural comparison (H4: ids and signatures differ across authors
// and moments; the SHAPE is what the criterion pins).
const shapeOf = (d: Delta): unknown[] =>
  [...d.claims.pointers]
    .map((p) => ({
      role: p.role,
      target:
        p.target.kind === "entity"
          ? { id: p.target.entity.id, context: p.target.entity.context }
          : p.target,
    }))
    .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));

const view = (
  r: { data?: unknown; errors?: unknown[] },
  field: string,
): Record<string, unknown> => {
  expect(r.errors, JSON.stringify(r.errors)).toBeUndefined();
  return (r.data as Record<string, Record<string, unknown>>)[field]!;
};

describe("§52 (c) — linkevent_attending authors the symmetric delta and the view nests shallow", () => {
  it("delta level: the spec's declared pointers, exactly; object level: a ShallowPerson view", async () => {
    const { gateway, backend } = await world();
    const named = await gateway.query(
      `mutation { shallowPerson(entity: "${MYK}", name: "Myk") { name } }`,
    );
    expect(named.errors, JSON.stringify(named.errors)).toBeUndefined();
    const settled = await idsOf(backend);

    const linked = await gateway.query(
      `mutation { linkevent_attending(entity: "${EVENT}", target: "${MYK}") { attending } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const linkedView = view(linked, "linkevent_attending");

    // DELTA level: one delta, the writer's, carrying the §52 declaration's exact roles and
    // contexts — {attending, at the person, context "attending"} + {attends, at the event,
    // context "attending"} — the shape the shelf's expand follows and the reciprocal folds.
    const fresh = await freshDeltas(gateway, backend, settled);
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(edge.claims.author).toBe(WRITER);
    expect(shapeOf(edge)).toEqual(
      shapeOf({
        id: "x",
        claims: {
          timestamp: 0,
          author: WRITER,
          pointers: [
            {
              role: "attending",
              target: { kind: "entity", entity: { id: MYK, context: "attending" } },
            },
            {
              role: "attends",
              target: { kind: "entity", entity: { id: EVENT, context: "attending" } },
            },
          ],
        },
      }),
    );

    // OBJECT level: the attendee reads as a nested ShallowPerson view — name, nothing more —
    // in the mutation's own answer and in a plain re-query alike.
    expect(linkedView["attending"]).toMatchObject([{ name: "Myk" }]);
    const reread = await gateway.query(`{ event(entity: "${EVENT}") { attending } }`);
    const attendees = view(reread, "event")["attending"] as Record<string, unknown>[];
    expect(attendees).toMatchObject([{ name: "Myk" }]);
    expect(attendees[0], "shallow means shallow — no graph rides along").not.toHaveProperty(
      "follows",
    );
    await gateway.close();
  });
});

describe("§52 (e) — the mutate seam refuses a primitive into a shelf reference, by name", () => {
  it("attending and members draw the §51 refusal naming their pair; a plain prop writes", async () => {
    const { gateway } = await world();
    await publishStock(gateway, "org");
    const hooks = gateway.gqlHooks();

    // The seam REST and direct callers reach — the GraphQL door's missing argument is not the
    // only wall (§51.5), and the refusal coaches toward the pair, never toward `writable`.
    await expect(hooks.mutate("Event", EVENT, { attending: MYK }, WRITER_SEED)).rejects.toThrow(
      /"attending" of Event is a reference \(§51\).*linkevent_attending/,
    );
    await expect(hooks.mutate("Org", "org:labs", { members: MYK }, WRITER_SEED)).rejects.toThrow(
      /"members" of Org is a reference \(§51\).*linkorg_members/,
    );
    // Two-sided: the plain prop beside each writes through the same seam.
    const ok = await hooks.mutate("Event", EVENT, { title: "The hike" }, WRITER_SEED);
    expect(ok.view["title"]).toBe("The hike");
    await gateway.close();
  });
});

describe("§52 (f) — unlink retracts the caller's own edge only; the legacy value and a second author survive", () => {
  it("object and delta level: one strike, writer's own, history intact", async () => {
    const { gateway, backend } = await world();
    // The legacy primitive — the exact delta shape a pre-retrofit §14 write minted (subject +
    // primitive value), planted directly because the retrofitted surface rightly refuses to.
    await gateway.append([observed(EVENT, "attending", "person:bob", 1_000, WRITER_SEED)]);
    const named = await gateway.query(
      `mutation { shallowPerson(entity: "${MYK}", name: "Myk") { name } }`,
    );
    expect(named.errors, JSON.stringify(named.errors)).toBeUndefined();

    const settled = await idsOf(backend);
    await gateway.query(
      `mutation { linkevent_attending(entity: "${EVENT}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const [writersEdge] = await freshDeltas(gateway, backend, settled);
    const afterWriter = await idsOf(backend);
    await gateway.query(
      `mutation { linkevent_attending(entity: "${EVENT}", target: "${MYK}") { _hex } }`,
      undefined,
      { actor: SECOND_SEED },
    );
    const [secondsEdge] = await freshDeltas(gateway, backend, afterWriter);

    // The full mixed array before the retraction: legacy value first (oldest), then both edges.
    const before = await gateway.query(`{ event(entity: "${EVENT}") { attending } }`);
    const all = view(before, "event")["attending"] as unknown[];
    expect(all).toHaveLength(3);
    expect(all[0]).toBe("person:bob");

    const unlinked = await gateway.query(
      `mutation { unlinkevent_attending(entity: "${EVENT}", target: "${MYK}") { attending } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    // OBJECT level, two-sided: the writer's edge is gone; the legacy primitive AND the second
    // author's edge both stand.
    const after = view(unlinked, "unlinkevent_attending")["attending"] as unknown[];
    expect(after).toHaveLength(2);
    expect(after[0], "the legacy bystander").toBe("person:bob");
    expect(after[1], "the second author's edge").toMatchObject({ name: "Myk" });

    // DELTA level: retraction is a claim — the edge delta survives beside its negation, the
    // strike is the writer's own, and the second author's edge drew NO strike.
    await gateway.flush();
    const held = await idsOf(backend);
    expect(held.has(writersEdge!.id), "history survives — nothing purged").toBe(true);
    const strikes = gateway.reactor.negationsOf(writersEdge!.id);
    expect(strikes.length).toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(gateway.reactor.get(strike)?.claims.author, "retract-your-OWN").toBe(WRITER);
    }
    expect(gateway.reactor.negationsOf(secondsEdge!.id)).toEqual([]);
    await gateway.close();
  });
});
