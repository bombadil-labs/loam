import { afterEach, describe, it, vi } from "vitest";
import {
  makeNegationClaims,
  type Claims,
  type Delta,
  type Reactor,
  type Schema,
} from "@bombadil/rhizomatic";
import { authorize, grantClaims, grantsHeldBy, holdsGrant } from "../../src/gateway/accounts.js";
import { honoredStrikeOn, type Verb } from "../../src/gateway/grants-law.js";
import { containerScopeImpl } from "../../src/gateway/container.js";
import {
  containerClaims,
  inboxName,
  readContainerTable,
  survivingWriteGrantIds,
} from "../../src/gateway/container-law.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import {
  assembleGenesis,
  CTX_OPERATOR,
  operatorMarkerClaims,
  STORE_ENTITY,
} from "../../src/gateway/genesis.js";
import { authoredBy } from "../../src/gateway/membership.js";
import { subtreeOf } from "../../src/server/subtree.js";
import { resolveUserView, roleClaims, rolesOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { bothOrders, idsOf, KEY, nameOf, Raw, record, SEEDS, signed, type Who } from "./corpus.js";
import { withStamp } from "../../src/gateway/stamp.js";

const NOW = 1_000_000;

afterEach(() => {
  vi.useRealTimers();
});

const strikeOf = (target: Delta, by: Who, t: number, label: string): Delta =>
  signed(makeNegationClaims(KEY[by], t, target.id), by, label);

const note = (by: Who, t: number, label: string): Delta =>
  signed(
    {
      timestamp: t,
      validFrom: t,
      author: KEY[by],
      pointers: [
        { role: "note", target: { kind: "entity", entity: { id: "note:1", context: "n" } } },
        { role: "text", target: { kind: "primitive", value: label } },
      ],
    },
    by,
    label,
  );

const markerOf = (who: Who): Delta => signed(operatorMarkerClaims(KEY[who]), who, `marker:${who}`);
const MARKERS = [markerOf("operator"), markerOf("stranger")];

const user = (name: string, by: Who, t: number) =>
  signed(userClaims(name, KEY[by], t), by, `user:${name} by ${by}@${t}`);
const role = (name: string, r: "operator" | "actor", by: Who, t: number) =>
  signed(roleClaims(name, r, KEY[by], t), by, `role:${name}=${r} by ${by}@${t}`);

const adaActor = role("ada", "actor", "operator", 12);
const deeActor = role("dee", "actor", "operator", 41);
const USERS: readonly Delta[] = [
  user("ada", "operator", 10),
  role("ada", "operator", "operator", 11),
  adaActor,
  strikeOf(adaActor, "operator", 13, "operator strikes ada=actor"),
  user("ada", "stranger", 14),
  role("ada", "actor", "stranger", 15),
  user("ada", "operator", 16),
  user("bob", "stranger", 20),
  role("bob", "operator", "stranger", 21),
  user("cy", "operator", 30),
  role("cy", "operator", "stranger", 31),
  user("dee", "operator", 40),
  deeActor,
  strikeOf(deeActor, "stranger", 42, "stranger strikes dee=actor"),
];

const grant = (by: Who, subject: Who, verb: Verb, t: number) =>
  signed(
    grantClaims(STORE_ENTITY, KEY[subject], verb, KEY[by], t),
    by,
    `${by}→${subject}:${verb}@${t}`,
  );

const oldWrite = grant("operator", "writer", "write", 10);
const newWrite = grant("operator", "peer", "write", 20);
const oldWriteStruck = strikeOf(oldWrite, "operator", 21, "operator strikes writer:write");

const strangerWrite = grant("operator", "stranger", "write", 9);
const oldAdmin = grant("operator", "writer", "admin", 10);
const delegated = grant("writer", "subadmin", "write", 11);
const adminStrike = strikeOf(
  strangerWrite,
  "writer",
  12,
  "writer (as admin) strikes stranger:write",
);
const newAdmin = grant("operator", "peer", "admin", 20);
const oldAdminStruck = strikeOf(oldAdmin, "operator", 21, "operator strikes writer:admin");

const WORLDS: Record<string, readonly Delta[]> = {
  "writer rotated, old grant kept": [oldWrite, newWrite],
  "writer rotated, old grant struck": [oldWrite, newWrite, oldWriteStruck],
  "admin before rotation": [strangerWrite, oldAdmin, delegated, adminStrike],
  "admin rotated, old grant kept": [strangerWrite, oldAdmin, delegated, adminStrike, newAdmin],
  "admin rotated, old grant struck": [
    strangerWrite,
    oldAdmin,
    delegated,
    adminStrike,
    newAdmin,
    oldAdminStruck,
  ],
};

const GRANT_DELTAS: readonly Delta[] = [
  oldWrite,
  newWrite,
  strangerWrite,
  oldAdmin,
  delegated,
  newAdmin,
];
const STRIKES: readonly Delta[] = [oldWriteStruck, adminStrike, oldAdminStruck];
const SUBJECTS: readonly Who[] = ["writer", "peer", "subadmin", "stranger"];

const pickLatest = { kind: "pick", order: { kind: "byTimestamp", dir: "desc" } } as const;
const NOTE_SCHEMA: Schema = {
  props: new Map([["tag", { kind: "all", order: { kind: "byTimestamp", dir: "asc" } }]]),
  default: pickLatest,
};
const NOTE_REG = {
  hyperschema: { name: "Note", alg: 1, body: entityGatherBody() },
  schema: NOTE_SCHEMA,
  roots: ["note:ada"],
  writable: ["tag"],
};

async function bootAda(backend = new MemoryBackend()): Promise<Gateway> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  return Gateway.boot(
    backend,
    assembleGenesis({
      operatorSeed: SEEDS.operator,
      registrations: [NOTE_REG],
      grants: [
        grantClaims(STORE_ENTITY, KEY.writer, "write", KEY.operator, 2),
        grantClaims(STORE_ENTITY, KEY.peer, "write", KEY.operator, 3),
      ],
    }),
  );
}

const outcome = async (gw: Gateway, d: Delta): Promise<unknown> => {
  try {
    await gw.append([d]);
    return "accepted";
  } catch (err) {
    return { refused: nameOf(err instanceof Error ? err.message : String(err)) };
  }
};

const operatorMarkersIn = (r: Reactor): string[] =>
  [...r.byTarget(STORE_ENTITY)]
    .map((id) => r.get(id)!)
    .filter((d) =>
      d.claims.pointers.some(
        (p) => p.target.kind === "entity" && p.target.entity.context === CTX_OPERATOR,
      ),
    )
    .map((d) => d.claims.author)
    .sort();

describe("recordings: principals", () => {
  it("content addresses of the corpus, markers and bare genesis", async () => {
    const genesisIds = (who: Who) =>
      assembleGenesis({ operatorSeed: SEEDS[who] }).deltas.map((d) => new Raw(d.id));
    await record("principal.ids", {
      corpus: idsOf([...MARKERS, ...USERS, ...GRANT_DELTAS, ...STRIKES]),
      genesis: { operator: genesisIds("operator"), stranger: genesisIds("stranger") },
    });
  });

  it("the gateway's operator comes from the seed, not the ground", async () => {
    const backend = new MemoryBackend();
    const booted = await bootAda(backend);
    const byOperator = (t: number): Claims => ({
      timestamp: t,
      validFrom: t,
      author: KEY.operator,
      pointers: [{ role: "tick", target: { kind: "primitive", value: t } }],
    });
    const byStranger = (t: number): Claims => ({ ...byOperator(t), author: KEY.stranger });
    const probe = async (gw: Gateway, t: number) => ({
      operatorAuthor: gw.operatorAuthor,
      markersInGround: operatorMarkersIn(gw.reactor),
      appendSignedByOperatorSeed: await outcome(gw, signed(byOperator(t), "operator")),
      appendSignedByStrangerSeed: await outcome(gw, signed(byStranger(t), "stranger")),
    });
    const out: Record<string, unknown> = {};
    out["booted with the operator seed"] = await probe(booted, NOW + 1);
    try {
      out["reopened with the stranger seed"] = await probe(
        await Gateway.open(backend, { seed: SEEDS.stranger }),
        NOW + 2,
      );
    } catch (err) {
      out["reopened with the stranger seed"] = {
        refused: nameOf(err instanceof Error ? err.message : String(err)),
      };
    }
    out["reopened with no seed"] = await probe(await Gateway.open(backend, {}), NOW + 3);
    try {
      out["rebooted with the stranger's genesis"] = await probe(
        await Gateway.boot(backend, assembleGenesis({ operatorSeed: SEEDS.stranger })),
        NOW + 4,
      );
    } catch (err) {
      out["rebooted with the stranger's genesis"] = {
        refused: nameOf(err instanceof Error ? err.message : String(err)),
      };
    }
    out["then reopened with the operator seed"] = await probe(
      await Gateway.open(backend, { seed: SEEDS.operator }),
      NOW + 5,
    );
    await record("principal.gateway-operator", out);
  });

  it("users and roles by the store seed and by another key", async () => {
    const names = ["ada", "bob", "cy", "dee", "nobody"];
    const read = (op: string | undefined) =>
      bothOrders(USERS, (r) =>
        Object.fromEntries(
          names.map((n) => [
            n,
            { view: resolveUserView(r, op, NOW, n), roles: rolesOf(r, op, NOW, n) },
          ]),
        ),
      );
    await record("principal.users", {
      "operator is the store seed": read(KEY.operator),
      "operator rotated to the stranger's key": read(KEY.stranger),
      "operator rotated to a key that signed nothing": read(KEY.peer),
      ungoverned: read(undefined),
    });
  });

  it("grants and strikes across a key rotation", async () => {
    const data = (by: Who) => note(by, 100, `data by ${by}`);
    const out: Record<string, unknown> = {};
    for (const [world, deltas] of Object.entries(WORLDS)) {
      out[world] = bothOrders(deltas, (r) => ({
        grantsHeldBy: Object.fromEntries(
          SUBJECTS.map((w) => [w, grantsHeldBy(r, NOW, KEY[w], KEY.operator)]),
        ),
        authorizeData: Object.fromEntries(
          SUBJECTS.map((w) => [w, authorize(r, NOW, data(w), KEY.operator).ok]),
        ),
        honoredStrikeOn: Object.fromEntries(
          deltas
            .filter((d) => GRANT_DELTAS.includes(d))
            .map((d) => [d.id, honoredStrikeOn(r, NOW, d.id, KEY.operator)?.id ?? null]),
        ),
        survivingWriteGrantIds: Object.fromEntries(
          SUBJECTS.map((w) => [w, survivingWriteGrantIds(r, NOW, KEY[w], KEY.operator)]),
        ),
      }));
    }
    await record("principal.grants-rotation", out);
  });

  it("a container owned by one key, and a rotated user's writes", async () => {
    const gw = await bootAda();
    const declare = (container: string, member: Who, parent?: string) =>
      signed(
        withStamp(gw.stamp(KEY.operator), (t) =>
          containerClaims(
            {
              container,
              trust: "curated",
              posture: "shared",
              membership: authoredBy(KEY[member]),
              ...(parent === undefined ? {} : { parent }),
            },
            KEY.operator,
            t,
          ),
        ),
        "operator",
      );
    await gw.append([declare("ada", "writer")]);
    await gw.append([declare("ada:notes", "writer", "ada")]);
    await gw.append([declare("adb", "peer")]);
    const strangerDecl = signed(
      containerClaims(
        { container: "bob", trust: "curated", posture: "shared", membership: authoredBy(KEY.peer) },
        KEY.stranger,
        NOW + 50,
      ),
      "stranger",
    );
    const strangerDeclared = await outcome(gw, strangerDecl);
    gw.reactor.ingest(strangerDecl);
    const writes = [
      note("writer", NOW + 60, "ada's write, first key"),
      note("peer", NOW + 61, "ada's write, rotated key"),
    ];
    await gw.append(writes);
    const writeIds = new Set(writes.map((d) => d.id));
    vi.setSystemTime(NOW + 100);
    const table = readContainerTable(gw.reactor, NOW + 100, KEY.operator);
    const labelsIn = (containers: string[]) =>
      containerScopeImpl(gw, { containers })
        .filter((d) => writeIds.has(d.id))
        .map((d) => d.id)
        .sort();
    await record("principal.container", {
      strangerDeclarationAtTheDoor: strangerDeclared,
      tableNames: [...table.containers.keys()].sort(),
      scope: {
        ada: labelsIn(["ada"]),
        "ada:notes": labelsIn(["ada:notes"]),
        adb: labelsIn(["adb"]),
      },
      subtreeOf: {
        ada: subtreeOf(table, "ada"),
        adb: subtreeOf(table, "adb"),
        bob: subtreeOf(table, "bob"),
      },
    });
  });

  it("retract-your-own after a key rotation", async () => {
    const gw = await bootAda();
    const hooks = gw.gqlHooks();
    const tags = () => gw.resolvedNode("Note", "note:ada").view["tag"];
    const steps: Record<string, unknown> = {};
    await hooks.mutate("Note", "note:ada", { tag: "first-key" }, SEEDS.writer);
    await hooks.mutate("Note", "note:ada", { tag: "rotated-key" }, SEEDS.peer);
    steps["both keys wrote"] = tags();
    await hooks.clear("Note", "note:ada", ["tag"], SEEDS.peer);
    steps["the rotated key clears tag"] = tags();
    await hooks.clear("Note", "note:ada", ["tag"], SEEDS.writer);
    steps["the first key clears tag"] = tags();
    await record("principal.retract", steps);
  });

  it("key recovery: the operator re-points a lost key to a new one", async () => {
    const run = async (strikeFirstKey: boolean) => {
      let at = NOW;
      const tick = () => vi.setSystemTime((at += 1_000));
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(at);
      const gw = await Gateway.boot(
        new MemoryBackend(),
        assembleGenesis({
          operatorSeed: SEEDS.operator,
          registrations: [NOTE_REG],
          grants: [grantClaims(STORE_ENTITY, KEY.writer, "write", KEY.operator, 2)],
        }),
      );
      const hooks = gw.gqlHooks();
      const tags = () => gw.resolvedNode("Note", "note:ada").view["tag"] ?? null;
      tick();
      await gw.append([
        signed(
          withStamp(gw.stamp(KEY.operator), (t) =>
            containerClaims(
              {
                container: "ada",
                trust: "curated",
                posture: "shared",
                membership: authoredBy(KEY.writer),
              },
              KEY.operator,
              t,
            ),
          ),
          "operator",
        ),
      ]);
      tick();
      await gw.bindConnection({
        container: "ada",
        connectionKey: KEY.subadmin,
        ownerSeed: SEEDS.writer,
      });
      const pool = gw.poolForBinding({
        container: "ada",
        inbox: inboxName("ada", KEY.subadmin),
      });
      tick();
      await hooks.mutate("Note", "note:ada", { tag: "first-key" }, SEEDS.writer);
      const before = tags();
      tick();
      const recovery = [
        signed(
          withStamp(gw.stamp(KEY.operator), (t) =>
            grantClaims(STORE_ENTITY, KEY.peer, "write", KEY.operator, t),
          ),
          "operator",
        ),
      ];
      if (strikeFirstKey) {
        const [grantId] = survivingWriteGrantIds(
          gw.reactor,
          gw.validityNow(),
          KEY.writer,
          KEY.operator,
        );
        recovery.push(
          signed(
            withStamp(gw.stamp(KEY.operator), (t) => makeNegationClaims(KEY.operator, t, grantId!)),
            "operator",
          ),
        );
      }
      await gw.append(recovery);
      tick();
      const holds = (r: Gateway, who: Who, verb: Verb) =>
        r
          .lawAuthors("grants")
          .some((a) => holdsGrant(r.reactor, r.validityNow(), STORE_ENTITY, KEY[who], verb, a));
      const standing = {
        newKeyWrite: holds(gw, "peer", "write"),
        firstKeyWrite: holds(gw, "writer", "write"),
      };
      const newKeyWrites = await outcome(gw, note("peer", at + 1, "ada's write, new key"));
      const firstKeyWrites = await outcome(gw, note("writer", at + 2, "ada's write, first key"));
      tick();
      await hooks.clear("Note", "note:ada", ["tag"], SEEDS.peer);
      const afterNewKeyClears = tags();
      tick();
      const connection = {
        firstKeyAdminInPool: holds(pool, "writer", "admin"),
        connectionWriteInPool: holds(pool, "subadmin", "write"),
        connectionWrites: await outcome(
          pool,
          note("subadmin", at + 1, "connection's write after the recovery"),
        ),
      };
      tick();
      const container = {
        membershipGathers: containerScopeImpl(gw, { containers: ["ada"] })
          .filter((d) => d.claims.author === KEY.writer || d.claims.author === KEY.peer)
          .map((d) => {
            const text = d.claims.pointers.find((p) => p.role === "text" || p.role === "value");
            const said =
              text?.target.kind === "primitive"
                ? String(text.target.value)
                : d.claims.pointers.map((p) => p.role).join("+");
            return `${nameOf(d.claims.author)}: ${said}`;
          })
          .sort(),
        tableNames: [
          ...readContainerTable(gw.reactor, gw.validityNow(), KEY.operator).containers.keys(),
        ].sort(),
      };
      return {
        before,
        standing,
        newKeyWrites,
        firstKeyWrites,
        afterNewKeyClears,
        connection,
        container,
      };
    };
    await record("principal.recovery", {
      "first key's grant kept": await run(false),
      "first key's grant struck": await run(true),
    });
  });
});
