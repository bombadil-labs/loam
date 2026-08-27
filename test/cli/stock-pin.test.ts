// T244 — the shelf's editorial content is PINNED (working spec §50, criterion 10; reverses
// §42.5's "no rail asserts the exact prop list").
//
// The convergence goal makes prop lists protocol: every edit moves the snapshot hash two
// federated strangers would otherwise share, so an editorial change must be a deliberate act —
// which is exactly what editing the PIN table below in the same change forces. The pin covers
// four things per entry: the exact prop set, the exact edge assignments (role → child program
// and reading, walked from the body), the exact reference declarations (§51 `refs` — role and
// reciprocal, since §52), and the shelf-wide ban on claimed identity fields.

import { describe, expect, it } from "vitest";
import { parseRegistrationInput, type RefSpecs } from "../../src/gateway/registration.js";
import { STOCK_SCHEMAS, stockNames } from "../../src/stock/index.js";
import { edgeAssignments } from "../../src/stock/graph.js";

interface Pin {
  readonly props: readonly string[];
  /** role → "ChildProgram/ChildReading", walked from the body's expands. */
  readonly edges: Readonly<Record<string, string>>;
  readonly writable: readonly string[];
  /** The §51 reference declarations, verbatim — a refs prop never sits in `writable` (§51.5). */
  readonly refs: RefSpecs;
}

// BY HAND, entry by entry — the §50 catalog as §52 retrofitted it, transcribed. Editing the shelf
// means editing this table in the same change; that friction is the feature.
const PIN: Record<string, Pin> = {
  event: {
    props: ["title", "startsAt", "endsAt", "location", "notes", "attending"],
    edges: { attending: "ShallowPerson/ShallowPerson" },
    writable: ["title", "startsAt", "endsAt", "location", "notes"],
    refs: {
      attending: { role: "attending", reciprocal: { role: "attends", context: "attending" } },
    },
  },
  note: {
    props: ["title", "body", "tags"],
    edges: {},
    writable: ["title", "body", "tags"],
    refs: {},
  },
  org: {
    props: ["name", "description", "website", "members"],
    edges: { members: "ShallowPerson/ShallowPerson" },
    writable: ["name", "description", "website"],
    // The role stays `members` — §14 `linkOrg` edges carry it, and the existing expand follows it.
    refs: {
      members: { role: "members", reciprocal: { role: "memberOf", context: "memberOf" } },
    },
  },
  person: {
    // `follows` is a declared reference with NO expand (T246 phase B): the reading stays flat by
    // design, which keeps the depth rail's `["person:bob"]` assertion true. No edge row here —
    // edges pin expand assignments, and this reference deliberately has none.
    props: ["name", "bio", "email", "follows"],
    edges: {},
    writable: ["name", "bio", "email"],
    refs: { follows: { role: "follows", reciprocal: { role: "followedBy", context: "followers" } } },
  },
  post: {
    props: ["title", "body", "publishedAt", "tags"],
    edges: {},
    writable: ["title", "body", "publishedAt", "tags"],
    refs: {},
  },
  "shallow-person": {
    props: ["name"],
    edges: {},
    writable: ["name"],
    refs: {},
  },
};

// The doctrine: no shelf shape carries a claimed identity. The delta signer IS the identity, and
// a latest-wins "author" string would read as provenance while being an ordinary overwritable
// value. `to` (recipients) and `mentions` are different speech acts and are not identity claims.
const IDENTITY_FIELDS = ["author", "from", "creator", "sender"] as const;

describe("the pin — §50's editorial content is protocol", () => {
  it("the pin table covers the shelf exactly", () => {
    expect(Object.keys(PIN).sort()).toEqual([...stockNames()].sort());
  });

  it("every entry's props, edges, writable, and refs match the pin exactly", () => {
    for (const entry of STOCK_SCHEMAS) {
      const pin = PIN[entry.name]!;
      const parsed = parseRegistrationInput(entry.registration);
      expect([...parsed.schema.props.keys()].sort(), `${entry.name} props`).toEqual(
        [...pin.props].sort(),
      );
      expect(parsed.writable, `${entry.name} writable`).toEqual(pin.writable);
      const edges: Record<string, string> = {};
      for (const e of edgeAssignments(entry)) edges[e.role] = `${e.schema}/${e.reading}`;
      expect(edges, `${entry.name} edges`).toEqual(PIN[entry.name]!.edges);
      expect(parsed.refs ?? {}, `${entry.name} refs`).toEqual(pin.refs);
    }
  });

  // §51.5 as a shelf-wide law, asserted from the PIN (the hand-written side, so a shelf that
  // drifted into the overlap fails against the table rather than against itself — H10): a
  // reference prop is never also writable, and every declared ref rides an existing prop.
  it("no pinned ref overlaps writable, and every pinned ref names a pinned prop", () => {
    for (const [name, pin] of Object.entries(PIN)) {
      for (const prop of Object.keys(pin.refs)) {
        expect(pin.writable, `${name}.${prop} must not be writable`).not.toContain(prop);
        expect(pin.props, `${name}.${prop} must be a declared prop`).toContain(prop);
      }
    }
  });

  it("no entry carries a claimed identity field", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      for (const field of IDENTITY_FIELDS) {
        expect(parsed.schema.props.has(field), `${entry.name}.${field}`).toBe(false);
      }
    }
  });

  // `alg: 1` is protocol too: it travels in the published definition deltas, so a shelf that
  // shipped a different alg would mint different definitions on every store that upgraded.
  it("every entry publishes alg 1, on the hyperschema and the schema alike", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.hyperschema.alg, `${entry.name} hyperschema.alg`).toBe(1);
      expect(parsed.schema.alg, `${entry.name} schema.alg`).toBe(1);
    }
  });

  // The shallow narrowing's exact BYTES are protocol: `{ exact: "name" }` and `{ inSet: ["name"] }`
  // narrow identically, but they are different bytes — a different body hash, which is the
  // convergence token two stranger stores compare. The choice is pinned so it cannot drift.
  it("shallow-person narrows with a single exact context, in those bytes", () => {
    const entry = STOCK_SCHEMAS.find((e) => e.name === "shallow-person")!;
    const body = entry.registration["hyperschema"] as { body: Record<string, unknown> };
    const select = (body.body["in"] as { pred: { hasPointer: { context: unknown } } }).pred;
    expect(select.hasPointer.context).toEqual({ exact: "name" });
  });

  // The frozen T85 per-entry invariants, restated over the GROWN shelf: T85's own file loops
  // every entry too, but a defect here should name this ticket's contract, and this file is the
  // one a §50 reviewer reads. Non-empty props and writable is also what admits a shallow entry
  // and refuses an { id }-only one — the premortem's finding 3, kept visible.
  it("every entry — shallow readings included — has non-empty props and writable", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.schema.props.size, entry.name).toBeGreaterThan(0);
      expect(parsed.writable?.length ?? 0, entry.name).toBeGreaterThan(0);
    }
  });
});
