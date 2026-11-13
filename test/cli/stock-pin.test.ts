import { describe, expect, it } from "vitest";
import { parseRegistrationInput, type RefSpecs } from "../../src/gateway/registration.js";
import { STOCK_SCHEMAS, stockNames } from "../../src/stock/index.js";
import { edgeAssignments } from "../../src/stock/graph.js";

interface Pin {
  readonly props: readonly string[];
  readonly edges: Readonly<Record<string, string>>;
  readonly writable: readonly string[];
  readonly refs: RefSpecs;
}

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
    refs: {
      members: { role: "members", reciprocal: { role: "memberOf", context: "memberOf" } },
    },
  },
  person: {
    props: ["name", "bio", "email", "follows"],
    edges: {},
    writable: ["name", "bio", "email"],
    refs: {
      follows: { role: "follows", reciprocal: { role: "followedBy", context: "followers" } },
    },
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

  it("every entry publishes alg 1, on the hyperschema and the schema alike", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.hyperschema.alg, `${entry.name} hyperschema.alg`).toBe(1);
      expect(parsed.schema.alg, `${entry.name} schema.alg`).toBe(1);
    }
  });

  it("shallow-person narrows with a single exact context, in those bytes", () => {
    const entry = STOCK_SCHEMAS.find((e) => e.name === "shallow-person")!;
    const body = entry.registration["hyperschema"] as { body: Record<string, unknown> };
    const select = (body.body["in"] as { pred: { hasPointer: { context: unknown } } }).pred;
    expect(select.hasPointer.context).toEqual({ exact: "name" });
  });

  it("every entry — shallow readings included — has non-empty props and writable", () => {
    for (const entry of STOCK_SCHEMAS) {
      const parsed = parseRegistrationInput(entry.registration);
      expect(parsed.schema.props.size, entry.name).toBeGreaterThan(0);
      expect(parsed.writable?.length ?? 0, entry.name).toBeGreaterThan(0);
    }
  });
});
