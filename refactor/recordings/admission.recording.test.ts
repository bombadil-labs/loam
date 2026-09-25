// Records Loam's grant, trust and admission decisions over one fixed corpus. A change in any
// decision shows as a diff in `out/`. Re-record on purpose with `npx vitest run refactor -u`.

import { describe, it } from "vitest";
import type { Claims, Delta } from "@bombadil/rhizomatic";
import {
  authorize,
  constitutionalDefect,
  dataStruck,
  fenceAdmits,
  grantClaims,
  grantsHeldBy,
  holdsGrant,
  honoredStrikeOn,
  VERBS,
  type Verb,
} from "../../src/gateway/accounts.js";
import { STORE_ENTITY } from "../../src/gateway/genesis.js";
import { readTrustPolicy, trustClaims, trustDefect } from "../../src/gateway/trust.js";
import {
  interpretBindingPolicy,
  type BindingCandidate,
  type BindingPolicyMode,
} from "../../src/gateway/binding-policy.js";
import { bothOrders, idsOf, KEY, record, signed, strike, WHO, type Who } from "./corpus.js";

const grant = (by: Who, subject: Who, verb: string, t: number, label: string, prefix?: string) =>
  signed(grantClaims(STORE_ENTITY, KEY[subject], verb as Verb, KEY[by], t, prefix), by, label);

const data = (by: Who, t: number): Claims => ({
  timestamp: t,
  author: KEY[by],
  pointers: [{ role: "note", target: { kind: "entity", entity: { id: "note:1", context: "n" } } }],
});

// The grant world: a two-link admin chain, a self-appointed admin, an admin cycle, an
// admin-minted register grant, malformed grants, and strikes with and without standing.
const adminGrant = grant("operator", "admin", "admin", 10, "op→admin:admin");
const subGrant = grant("admin", "subadmin", "admin", 11, "admin→subadmin:admin");
const writerGrant = grant("subadmin", "writer", "write", 12, "subadmin→writer:write");
const selfAdmin = grant("stranger", "stranger", "admin", 13, "stranger→stranger:admin");
const strangerMint = grant("stranger", "peer", "write", 14, "stranger→peer:write");
const cycleAB = grant("cycleA", "cycleB", "admin", 15, "cycleA→cycleB:admin");
const cycleBA = grant("cycleB", "cycleA", "admin", 16, "cycleB→cycleA:admin");
const adminRegister = grant("admin", "admin", "register", 17, "admin→admin:register", "adm:");
const writerRegister = grant("operator", "writer", "register", 18, "op→writer:register", "w:");
const writerFederate = grant("operator", "writer", "federate", 19, "op→writer:federate", "friends");
const badVerb = grant("operator", "peer", "fly", 20, "op→peer:fly(malformed)");
const peerWrite = grant("operator", "peer", "write", 21, "op→peer:write");
const adminStrike = strike(peerWrite, "admin", 22);
const strangerStrike = strike(adminGrant, "stranger", 23);
const revived = grant("operator", "cycleA", "write", 24, "op→cycleA:write");
const revivedStrike = strike(revived, "operator", 25);
const counterStrike = strike(revivedStrike, "operator", 26);

const GRANTS: readonly Delta[] = [
  adminGrant,
  subGrant,
  writerGrant,
  selfAdmin,
  strangerMint,
  cycleAB,
  cycleBA,
  adminRegister,
  writerRegister,
  writerFederate,
  badVerb,
  peerWrite,
  adminStrike,
  strangerStrike,
  revived,
  revivedStrike,
  counterStrike,
];

const OPERATORS = { governed: KEY.operator, ungoverned: undefined } as const;

describe("recordings: grants, trust and admission", () => {
  it("content addresses of the corpus", async () => {
    await record("admission.ids", idsOf(GRANTS));
  });

  it("holdsGrant for every author and verb", async () => {
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = bothOrders(GRANTS, (r) =>
        Object.fromEntries(
          WHO.map((w) => [
            w,
            Object.fromEntries(
              [...VERBS].map((v) => [v, holdsGrant(r, STORE_ENTITY, KEY[w], v as Verb, op)]),
            ),
          ]),
        ),
      );
    }
    await record("admission.holdsGrant", out);
  });

  it("grantsHeldBy for every author", async () => {
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = bothOrders(GRANTS, (r) =>
        Object.fromEntries(WHO.map((w) => [w, grantsHeldBy(r, KEY[w], op)])),
      );
    }
    await record("admission.grantsHeldBy", out);
  });

  it("honoredStrikeOn and dataStruck for every delta", async () => {
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = bothOrders(GRANTS, (r) => {
        const struck = dataStruck(r, op);
        return Object.fromEntries(
          GRANTS.map((d) => [
            d.id,
            { honoredStrike: honoredStrikeOn(r, d.id, op), struck: struck(d.id) },
          ]),
        );
      });
    }
    await record("admission.strikes", out);
  });

  it("authorize for data, grants and trust declarations from every author", async () => {
    const candidates: [string, Delta][] = [
      ...WHO.map((w): [string, Delta] => [`data by ${w}`, signed(data(w, 100), w)]),
      [
        "grant with unknown verb",
        signed(grantClaims(STORE_ENTITY, KEY.peer, "fly" as Verb, KEY.operator, 101), "operator"),
      ],
      [
        "trust roster by operator",
        signed(trustClaims("roster", [KEY.peer], KEY.operator, 102), "operator"),
      ],
      [
        "trust closed by stranger",
        signed(trustClaims("closed", [], KEY.stranger, 103), "stranger"),
      ],
      [
        "trust with two modes",
        signed(
          {
            ...trustClaims("open", [], KEY.operator, 104),
            pointers: [
              ...trustClaims("open", [], KEY.operator, 104).pointers,
              { role: "mode", target: { kind: "primitive", value: "closed" } },
            ],
          },
          "operator",
        ),
      ],
    ];
    const out: Record<string, unknown> = {};
    for (const [mode, op] of Object.entries(OPERATORS)) {
      out[mode] = bothOrders(GRANTS, (r) =>
        Object.fromEntries(candidates.map(([name, d]) => [name, authorize(r, d, op)])),
      );
    }
    const shapes = Object.fromEntries(
      candidates.map(([name, d]) => [
        name,
        { constitutionalDefect: constitutionalDefect(d), trustDefect: trustDefect(d.claims) },
      ]),
    );
    await record("admission.authorize", { verdicts: out, shapes });
  });

  it("readTrustPolicy over declaration histories", async () => {
    const decl = (
      by: Who,
      mode: "open" | "roster" | "closed",
      admit: Who[],
      t: number,
      label: string,
    ) =>
      signed(
        trustClaims(
          mode,
          admit.map((w) => KEY[w]),
          KEY[by],
          t,
        ),
        by,
        label,
      );
    const rosterA = decl("operator", "roster", ["peer"], 30, "trust:roster[peer]");
    const rosterB = decl("operator", "roster", ["writer"], 31, "trust:roster[writer]");
    const closedLatest = decl("operator", "closed", [], 32, "trust:closed");
    const tieOpen = decl("operator", "open", [], 32, "trust:open@32");
    const strangerClosed = decl("stranger", "closed", [], 40, "trust:closed-by-stranger");
    const histories: Record<string, Delta[]> = {
      empty: [],
      "one roster": [rosterA],
      "two rosters union": [rosterA, rosterB],
      "latest closed": [rosterA, rosterB, closedLatest],
      "latest closed, struck": [
        rosterA,
        rosterB,
        closedLatest,
        strike(closedLatest, "operator", 33),
      ],
      "same-timestamp tie": [rosterA, closedLatest, tieOpen],
      "stranger declares closed": [rosterA, strangerClosed],
      "stranger strikes the roster": [rosterA, strike(rosterA, "stranger", 41)],
    };
    const out: Record<string, unknown> = {};
    for (const [name, deltas] of Object.entries(histories)) {
      out[name] = Object.fromEntries(
        Object.entries(OPERATORS).map(([mode, op]) => [
          mode,
          bothOrders(deltas, (r) => readTrustPolicy(r, op)),
        ]),
      );
    }
    await record("admission.trustPolicy", out);
  });

  it("interpretBindingPolicy over contests, versions and ties", async () => {
    const c = (lens: string, entity: string, by: Who, t: number, id: string): BindingCandidate => ({
      lens,
      entity,
      author: KEY[by],
      timestamp: t,
      deltaId: id,
    });
    const sets: Record<string, BindingCandidate[]> = {
      "single binding": [c("Film", "hyperschema:Film", "operator", 1, "d1")],
      "two versions of one entity": [
        c("Film", "hyperschema:Film", "operator", 1, "d1"),
        c("Film", "hyperschema:Film", "operator", 2, "d2"),
      ],
      "two entities contest one lens": [
        c("Film", "hyperschema:Film", "writer", 1, "d1"),
        c("Film", "hyperschema:Movie", "operator", 2, "d2"),
      ],
      "operator older than stranger": [
        c("Film", "hyperschema:Film", "operator", 1, "d1"),
        c("Film", "hyperschema:Movie", "stranger", 5, "d2"),
      ],
      "timestamp tie broken by id": [
        c("Film", "hyperschema:A", "writer", 3, "d9"),
        c("Film", "hyperschema:B", "writer", 3, "d1"),
      ],
      "space inside an entity name": [
        c("B C", "hyperschema:A", "writer", 1, "d1"),
        c("C", "hyperschema:A B", "writer", 2, "d2"),
      ],
    };
    const modes: BindingPolicyMode[] = ["byTimestamp", "byAuthorRank", "conflicts"];
    const out: Record<string, unknown> = {};
    for (const [name, cands] of Object.entries(sets)) {
      out[name] = Object.fromEntries(
        modes.flatMap((m) =>
          Object.entries(OPERATORS).map(([mode, op]) => [
            `${m}/${mode}`,
            interpretBindingPolicy(cands, m, op),
          ]),
        ),
      );
    }
    await record("admission.bindingPolicy", out);
  });

  it("fenceAdmits over prefix and name pairs", async () => {
    const pairs: [string, string][] = [
      ["", "anything"],
      ["w:", "w:film"],
      ["w:", "W:film"],
      ["w:", "w"],
      ["w:", "ｗ:film"],
      ["friends", "friends-archive"],
    ];
    await record(
      "admission.fence",
      pairs.map(([p, n]) => ({ prefix: p, name: n, admits: fenceAdmits(p, n) })),
    );
  });
});
