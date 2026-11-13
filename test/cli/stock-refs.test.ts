import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorForSeed, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { entityGatherJson, expandedGatherJson } from "../../src/gateway/gather.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { installOrder } from "../../src/stock/graph.js";
import { stockSchema } from "../../src/stock/index.js";
import { pickLatest } from "../gateway/fixtures.js";
import { observed } from "../spike/garden.js";

vi.setConfig({ testTimeout: 30_000 });

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

describe("§52 (a) — the introspected shelf teaches the truth, all three references typed", () => {
  it("event, org, and person serve typed pairs; no reference offers a primitive argument", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "event", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);

    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      const fields = await mutationSurface(handle.url);

      for (const pair of [
        "linkevent_attending",
        "unlinkevent_attending",
        "linkorg_members",
        "unlinkorg_members",
      ]) {
        expect(fields.get(pair), pair).toBeDefined();
        expect(fields.get(pair)!.args, pair).toEqual({ entity: "ID!", target: "ID!" });
      }

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
      expect(fields.get("event")!.description).toContain("Reference props");
      expect(fields.get("event")!.description).toContain("attending");
      expect(fields.get("event")!.description).not.toMatch(/Read-only here.*attending/);

      expect(fields.get("person")!.args).toEqual({
        entity: "ID!",
        name: "PrimitiveValue",
        bio: "PrimitiveValue",
        email: "PrimitiveValue",
      });
      expect(fields.get("linkperson_follows")!.args).toEqual({ entity: "ID!", target: "ID!" });
      expect(fields.get("unlinkperson_follows")!.args).toEqual({ entity: "ID!", target: "ID!" });
    } finally {
      await handle.close();
    }
  });
});

describe("§52 (b) — the §14 link verb is refs-aware, two-sided", () => {
  it("linkOrg links members with members OFF writable; a non-refs unopened field still refuses", async () => {
    const org = stockSchema("org")!.registration as { writable: string[] };
    expect(
      org.writable,
      "members must be off writable for this rail to mean anything",
    ).not.toContain("members");

    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "org", "--home", home], io())).toBe(0);
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);
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
      let res = await gql(
        handle.url,
        `mutation { person(entity: "person:ada", name: "Ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      res = await gql(
        handle.url,
        `mutation { linkOrg(entity: "org:labs", field: "members", target: "person:ada") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      const read = await gql(handle.url, `{ org(entity: "org:labs") { members } }`);
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      const members = (read.data?.["org"] as { members: unknown[] }).members;
      expect(members).toMatchObject([{ name: "Ada" }]);

      const refused = await gql(
        handle.url,
        `mutation { linkTeam(entity: "team:reds", field: "rivals", target: "team:blues") { title } }`,
      );
      expect(refused.errors?.join(" ")).toMatch(/"rivals" of Team is read-only/);
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
      const wrote = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", title: "Picnic", attending: "person:bob") { attending } }`,
      );
      expect(wrote.errors, JSON.stringify(wrote.errors)).toBeUndefined();
      expect((wrote.data?.["event"] as { attending: unknown }).attending).toEqual(["person:bob"]);
    } finally {
      await handle.close();
    }

    out.length = 0;
    err.length = 0;
    expect(await run(["register", "--stock", "event", "--home", home], io())).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/also installed shallow-person/);
    expect(printed).toMatch(/Event was already bound — this publish evolves it/);
    expect(err.join("\n")).not.toMatch(/does not bind/);

    handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      const fossil = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", attending: "person:eve") { attending } }`,
      );
      expect(fossil.errors?.join(" ")).toMatch(/Unknown argument "attending"/);
      const title = await gql(
        handle.url,
        `mutation { event(entity: "event:picnic", title: "Spring picnic") { title } }`,
      );
      expect(title.errors, JSON.stringify(title.errors)).toBeUndefined();

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

const OPERATOR_SEED = "0e".repeat(32);
const OPERATOR = authorForSeed(OPERATOR_SEED);
const WRITER_SEED = "e1".repeat(32);
const WRITER = authorForSeed(WRITER_SEED);
const SECOND_SEED = "e2".repeat(32);

const EVENT = "event:hike";
const MYK = "person:myk";

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

    const fresh = await freshDeltas(gateway, backend, settled);
    expect(fresh).toHaveLength(1);
    const edge = fresh[0]!;
    expect(edge.claims.author).toBe(WRITER);
    expect(shapeOf(edge)).toEqual(
      shapeOf({
        id: "x",
        claims: {
          timestamp: 0,
          validFrom: 0,
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

    await expect(hooks.mutate("Event", EVENT, { attending: MYK }, WRITER_SEED)).rejects.toThrow(
      /"attending" of Event is a reference \(§51\).*linkevent_attending/,
    );
    await expect(hooks.mutate("Org", "org:labs", { members: MYK }, WRITER_SEED)).rejects.toThrow(
      /"members" of Org is a reference \(§51\).*linkorg_members/,
    );
    const ok = await hooks.mutate("Event", EVENT, { title: "The hike" }, WRITER_SEED);
    expect(ok.view["title"]).toBe("The hike");
    await gateway.close();
  });
});

describe("§52 (f) — unlink retracts the caller's own edge only; the legacy value and a second author survive", () => {
  it("object and delta level: one strike, writer's own, history intact", async () => {
    const { gateway, backend } = await world();
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

    const before = await gateway.query(`{ event(entity: "${EVENT}") { attending } }`);
    const all = view(before, "event")["attending"] as unknown[];
    expect(all).toHaveLength(3);
    expect(all[0]).toBe("person:bob");

    const unlinked = await gateway.query(
      `mutation { unlinkevent_attending(entity: "${EVENT}", target: "${MYK}") { attending } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const after = view(unlinked, "unlinkevent_attending")["attending"] as unknown[];
    expect(after).toHaveLength(2);
    expect(after[0], "the legacy bystander").toBe("person:bob");
    expect(after[1], "the second author's edge").toMatchObject({ name: "Myk" });

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

describe("§52 — a §14-written edge is retractable through the §51 pair (the role coincidence, live)", () => {
  it("linkOrg mints the edge, unlinkorg_members strikes it; a second author's edge survives", async () => {
    const { gateway, backend } = await world();
    await publishStock(gateway, "org");
    const named = await gateway.query(
      `mutation { shallowPerson(entity: "${MYK}", name: "Myk") { name } }`,
    );
    expect(named.errors, JSON.stringify(named.errors)).toBeUndefined();

    const settled = await idsOf(backend);
    await gateway.query(
      `mutation { linkOrg(entity: "org:labs", field: "members", target: "${MYK}") { name } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    const [writersEdge] = await freshDeltas(gateway, backend, settled);
    expect(
      writersEdge!.claims.pointers.some(
        (p) => p.role === "members" && p.target.kind === "entity" && p.target.entity.id === MYK,
      ),
      "the §14 edge carries the declared refs role",
    ).toBe(true);
    const afterWriter = await idsOf(backend);
    await gateway.query(
      `mutation { linkOrg(entity: "org:labs", field: "members", target: "${MYK}") { name } }`,
      undefined,
      { actor: SECOND_SEED },
    );
    const [secondsEdge] = await freshDeltas(gateway, backend, afterWriter);
    const before = await gateway.query(`{ org(entity: "org:labs") { members } }`);
    expect(view(before, "org")["members"]).toMatchObject([{ name: "Myk" }, { name: "Myk" }]);

    const unlinked = await gateway.query(
      `mutation { unlinkorg_members(entity: "org:labs", target: "${MYK}") { members } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(unlinked, "unlinkorg_members")["members"]).toMatchObject([{ name: "Myk" }]);

    await gateway.flush();
    expect((await idsOf(backend)).has(writersEdge!.id), "history survives").toBe(true);
    const strikes = gateway.reactor.negationsOf(writersEdge!.id);
    expect(strikes.length, "the §14 edge is negated").toBeGreaterThan(0);
    for (const strike of strikes) {
      expect(gateway.reactor.get(strike)?.claims.author, "retract-your-OWN").toBe(WRITER);
    }
    expect(gateway.reactor.negationsOf(secondsEdge!.id)).toEqual([]);
    await gateway.close();
  });
});

describe("§52 — a refs declaration the body does not back cannot open the §14 door", () => {
  it("both mismatch shapes refuse read-only; the agreeing shelf prop still links", async () => {
    const { gateway } = await world();
    const allAsc = { kind: "all", order: { kind: "byTimestamp", dir: "asc" } } as const;
    const outcome = await gateway.publishRegistration(
      {
        name: "Advisory",
        alg: 1,
        body: parseTerm({
          op: "expand",
          role: { exact: "members" },
          schema: "ShallowPerson",
          reading: "ShallowPerson",
          in: {
            op: "expand",
            role: { prefix: "rel:" },
            schema: "ShallowPerson",
            reading: "ShallowPerson",
            in: entityGatherJson(),
          },
        }),
      },
      {
        name: "Advisory",
        props: new Map([
          ["name", pickLatest],
          ["members", allAsc],
          ["advisors", allAsc],
          ["contacts", allAsc],
        ]),
        default: pickLatest,
      },
      [],
      undefined,
      undefined,
      undefined,
      ["name"],
      undefined,
      {
        advisors: { role: "advises", reciprocal: { role: "advisedBy", context: "advisories" } },
        contacts: { role: "rel:knows" },
      },
    );
    expect(outcome.bound).toBe(true);

    const noExpand = await gateway.query(
      `mutation { linkAdvisory(entity: "advisory:board", field: "advisors", target: "${MYK}") { name } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(noExpand.errors?.join(" ")).toMatch(/"advisors" of Advisory is read-only/);
    const family = await gateway.query(
      `mutation { linkAdvisory(entity: "advisory:board", field: "contacts", target: "${MYK}") { name } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(family.errors?.join(" ")).toMatch(/"contacts" of Advisory is read-only/);

    const named = await gateway.query(
      `mutation { shallowPerson(entity: "${MYK}", name: "Myk") { name } }`,
    );
    expect(named.errors, JSON.stringify(named.errors)).toBeUndefined();
    const linked = await gateway.query(
      `mutation { linkEvent(entity: "${EVENT}", field: "attending", target: "${MYK}") { attending } }`,
      undefined,
      { actor: WRITER_SEED },
    );
    expect(view(linked, "linkEvent")["attending"]).toMatchObject([{ name: "Myk" }]);
    await gateway.close();
  });
});

describe("§52 (i) — phase B: follows links typed, and the flat read the frozen rail asserts survives", () => {
  it("link resolves flat, folds the far side, refuses the fossil, and unlinks clean", async () => {
    await run(["init", "--home", home], io());
    expect(await run(["register", "--stock", "person", "--home", home], io())).toBe(0);
    const handle = await serveDetached(["--home", home, "--port", "0", "--token", "t"]);
    try {
      let res = await gql(
        handle.url,
        `mutation { linkperson_follows(entity: "person:ada", target: "person:bob") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();

      const read = await gql(handle.url, `{ person(entity: "person:ada") { follows } }`);
      expect(read.errors, JSON.stringify(read.errors)).toBeUndefined();
      expect((read.data?.["person"] as { follows: unknown }).follows).toEqual(["person:bob"]);

      const far = await gql(handle.url, `{ person(entity: "person:bob") { _view } }`);
      expect(far.errors, JSON.stringify(far.errors)).toBeUndefined();
      const view = (far.data?.["person"] as { _view: Record<string, unknown> })._view;
      expect(view["followers"]).toEqual("person:ada");

      const fossil = await gql(
        handle.url,
        `mutation { person(entity: "person:ada", follows: "person:carol") { name } }`,
      );
      expect(JSON.stringify(fossil.errors)).toMatch(/Unknown argument/);

      res = await gql(
        handle.url,
        `mutation { unlinkperson_follows(entity: "person:ada", target: "person:bob") { name } }`,
      );
      expect(res.errors, JSON.stringify(res.errors)).toBeUndefined();
      const after = await gql(handle.url, `{ person(entity: "person:ada") { follows } }`);
      const follows = (after.data?.["person"] as { follows: unknown }).follows;
      expect(follows === null || (Array.isArray(follows) && follows.length === 0)).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
