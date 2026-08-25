// T244 — the shelf's editorial content is PINNED (working spec §50, criterion 10; reverses
// §42.5's "no rail asserts the exact prop list").
//
// The convergence goal makes prop lists protocol: every edit moves the snapshot hash two
// federated strangers would otherwise share, so an editorial change must be a deliberate act —
// which is exactly what editing the PIN table below in the same change forces. The pin covers
// three things per entry: the exact prop set, the exact edge assignments (role → child program
// and reading, walked from the body), and the shelf-wide ban on claimed identity fields.

import { describe, expect, it } from "vitest";
import { parseRegistrationInput } from "../../src/gateway/registration.js";
import { STOCK_SCHEMAS, stockNames } from "../../src/stock/index.js";
import { edgeAssignments } from "../../src/stock/graph.js";

interface Pin {
  readonly props: readonly string[];
  /** role → "ChildProgram/ChildReading", walked from the body's expands. */
  readonly edges: Readonly<Record<string, string>>;
  readonly writable: readonly string[];
}

// BY HAND, entry by entry — the §50 catalog, transcribed. Editing the shelf means editing this
// table in the same change; that friction is the feature.
const PIN: Record<string, Pin> = {
  event: {
    props: ["title", "startsAt", "endsAt", "location", "notes", "attending"],
    edges: {},
    writable: ["title", "startsAt", "endsAt", "location", "notes", "attending"],
  },
  note: {
    props: ["title", "body", "tags"],
    edges: {},
    writable: ["title", "body", "tags"],
  },
  org: {
    props: ["name", "description", "website", "members"],
    edges: { members: "ShallowPerson/ShallowPerson" },
    writable: ["name", "description", "website", "members"],
  },
  person: {
    props: ["name", "bio", "email", "follows"],
    edges: {},
    writable: ["name", "bio", "email", "follows"],
  },
  post: {
    props: ["title", "body", "publishedAt", "tags"],
    edges: {},
    writable: ["title", "body", "publishedAt", "tags"],
  },
  "shallow-person": {
    props: ["name"],
    edges: {},
    writable: ["name"],
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

  it("every entry's props, edges, and writable match the pin exactly", () => {
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
