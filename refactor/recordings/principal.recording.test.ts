// Records Loam's answers to "which key is this principal" before step 5 moves roots, key binding,
// succession and delegation into signed data. Today a principal IS a key: nothing in the ground
// links two keys, and the operator is whoever holds the seed the process was opened with.
//
// Cast: `operator` is the store seed. `writer` is ada's first key and `peer` is ada's rotated key
// (the rotation is a revoke plus a re-mint, the only form Loam has). `stranger` asserts names and
// roles it has no standing for. `subadmin` holds a grant minted by ada's first key.
//
// Recorded:
// - `principal.ids`: content addresses of the corpus, including each seed's operator marker and
//   bare genesis. "Same operator" rests on these ids being stable.
// - `principal.gateway-operator`: the gateway's operator comes from the seed option, and the
//   ground's operator markers do not change it.
// - `principal.users`: `resolveUserView` and `rolesOf` for names asserted by the store seed and by
//   another key, read with the original operator, a rotated operator, and no operator.
// - `principal.grants-rotation`: `grantsHeldBy`, `authorize`, `honoredStrikeOn` and
//   `survivingWriteGrantIds` across a key rotation, for a writer and for an admin whose grants and
//   strikes were made under the old key.
// - `principal.container`: a container owned by membership `authoredBy(<key>)`, which of a rotated
//   user's writes its scope gathers, and `subtreeOf` reach by name.
// - `principal.retract`: the retract-your-own check (`mutate.ts`) after a rotation.
// - `principal.recovery`: ada's first key (`writer`) is lost and the operator re-points her to a
//   new key (`peer`). Today that is a new write grant for the new key, which is what
//   `ensureUserKey` appends when the seed file is gone; nothing links the two keys. `subadmin` is
//   a connection the first key bound to her container. Recorded with the first key's store grant
//   kept (the file that named it is gone, so `remove-role` cannot find it) and struck.
//
// Deliberately not recorded: admission (see `admission.recording.test.ts`); the token door's
// `resolve`/`describe` and `resolveClientBearer`, which read `oauth.json` and `clients.json` rather
// than signed data and need a home directory; `openerStands` and bound inbox pools, which need a
// pool backend factory. The users and grants readers run over raw-ingest reactors, so no door ran
// on their corpus. Order dependence is checked forward and reverse only.

import { afterEach, describe, it, vi } from "vitest";
import {
  makeNegationClaims,
  type Claims,
  type Delta,
  type Reactor,
  type Schema,
} from "@bombadil/rhizomatic";
import {
  authorize,
  grantClaims,
  grantsHeldBy,
  holdsGrant,
  honoredStrikeOn,
  type Verb,
} from "../../src/gateway/accounts.js";
import {
  containerClaims,
  inboxName,
  containerScopeImpl,
  readContainerTable,
  survivingWriteGrantIds,
} from "../../src/gateway/container.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { entityGatherBody } from "../../src/gateway/gather.js";
import {
  assembleGenesis,
  CTX_OPERATOR,
  operatorMarkerClaims,
  STORE_ENTITY,
} from "../../src/gateway/genesis.js";
import { authoredBy } from "../../src/server/provision.js";
import { subtreeOf } from "../../src/server/subtree.js";
import { resolveUserView, roleClaims, rolesOf, userClaims } from "../../src/server/users.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { bothOrders, idsOf, KEY, nameOf, Raw, record, SEEDS, signed, type Who } from "./corpus.js";
import { withStamp } from "../../src/gateway/stamp.js";

const NOW = 1_000_000;

afterEach(() => {
  vi.useRealTimers();
});

// A strike with a printed name, so a golden says whose strike retired what.
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

// --- markers ------------------------------------------------------------------------------------

const markerOf = (who: Who): Delta => signed(operatorMarkerClaims(KEY[who]), who, `marker:${who}`);
const MARKERS = [markerOf("operator"), markerOf("stranger")];

// --- users --------------------------------------------------------------------------------------

const user = (name: string, by: Who, t: number) =>
  signed(userClaims(name, KEY[by], t), by, `user:${name} by ${by}@${t}`);
const role = (name: string, r: "operator" | "actor", by: Who, t: number) =>
  signed(roleClaims(name, r, KEY[by], t), by, `role:${name}=${r} by ${by}@${t}`);

const adaActor = role("ada", "actor", "operator", 12);
const deeActor = role("dee", "actor", "operator", 41);
const USERS: readonly Delta[] = [
  // ada: operator-signed user and roles, then the actor role struck by the operator.
  user("ada", "operator", 10),
  role("ada", "operator", "operator", 11),
  adaActor,
  strikeOf(adaActor, "operator", 13, "operator strikes ada=actor"),
  // ada again, asserted by a second key: the same user entity, a different author.
  user("ada", "stranger", 14),
  role("ada", "actor", "stranger", 15),
  // ada's record repeated by the operator at a later time.
  user("ada", "operator", 16),
  // bob: asserted by the stranger alone.
  user("bob", "stranger", 20),
  role("bob", "operator", "stranger", 21),
  // cy: operator-signed user, stranger-signed operator role.
  user("cy", "operator", 30),
  role("cy", "operator", "stranger", 31),
  // dee: operator-signed user and role; the stranger strikes the role.
  user("dee", "operator", 40),
  deeActor,
  strikeOf(deeActor, "stranger", 42, "stranger strikes dee=actor"),
];

// --- grants across a rotation -------------------------------------------------------------------

const grant = (by: Who, subject: Who, verb: Verb, t: number) =>
  signed(
    grantClaims(STORE_ENTITY, KEY[subject], verb, KEY[by], t),
    by,
    `${by}→${subject}:${verb}@${t}`,
  );

// A writer rotates: ada's first key holds write, then her second key is granted write.
const oldWrite = grant("operator", "writer", "write", 10);
const newWrite = grant("operator", "peer", "write", 20);
const oldWriteStruck = strikeOf(oldWrite, "operator", 21, "operator strikes writer:write");

// An admin rotates: ada's first key holds admin, mints a write grant, and strikes another grant.
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

// --- a gateway over a note lens -----------------------------------------------------------------

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

// A gateway whose operator is the store seed, with ada's first and rotated keys both granted write.
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
    out["reopened with the stranger seed"] = await probe(
      await Gateway.open(backend, { seed: SEEDS.stranger }),
      NOW + 2,
    );
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
    // Refused at the door or not, the declaration is put in the ground so the reader weighs it.
    gw.reactor.ingest(strangerDecl);
    const writes = [
      note("writer", NOW + 60, "ada's write, first key"),
      note("peer", NOW + 61, "ada's write, rotated key"),
    ];
    await gw.append(writes);
    const writeIds = new Set(writes.map((d) => d.id));
    // One read time for the table and the scopes: the declarations are valid from their
    // `nextTimestamp`, which runs ahead of the clock set at boot.
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
      // Only the first key holds write before the recovery.
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
      // Her container, owned by membership on the first key, as `declareOwned` writes it.
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
      // The recovery: the first key is lost; the operator grants the new key write.
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
        holdsGrant(r.reactor, r.validityNow(), STORE_ENTITY, KEY[who], verb, KEY.operator);
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
        // Ada's own deltas the container gathers, by signing key: her tag write and her notes.
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
