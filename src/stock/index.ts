import { entityGatherJson, expandedGatherJson } from "../gateway/gather.js";

export interface StockSchema {
  readonly name: string;
  readonly summary: string;

  readonly registration: Readonly<Record<string, unknown>>;
}

const LATEST = () => ({ pick: { order: { byTimestamp: "desc" } } });
const EVERY = () => ({ all: { order: { byTimestamp: "asc" } } });

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  for (const v of Object.values(value)) deepFreeze(v);
  return Object.freeze(value);
}

function plain(
  name: string,
  props: Readonly<Record<string, unknown>>,
  writable: readonly string[],
  body: Record<string, unknown> = entityGatherJson(),
  refs?: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    hyperschema: { name, alg: 1, body },
    schema: { name, alg: 1, props: { ...props }, default: LATEST() },
    roots: [] as string[],
    writable: [...writable],
    ...(refs === undefined ? {} : { refs }),
  });
}

function shallowGatherJson(contexts: readonly string[]): Record<string, unknown> {
  const context =
    contexts.length === 1 ? { exact: contexts[0] } : { inSet: [...contexts] as string[] };
  return {
    op: "group",
    key: "byTargetContext",
    in: {
      op: "select",
      pred: { hasPointer: { targetEntity: { var: "root" }, context } },
      in: { op: "mask", policy: "drop", in: "input" },
    },
  };
}

export const STOCK_SCHEMAS: readonly StockSchema[] = deepFreeze<readonly StockSchema[]>([
  {
    name: "event",
    summary: "something happening — a title, when and where, and who is coming, read shallow",
    registration: plain(
      "Event",
      {
        title: LATEST(),
        startsAt: LATEST(),
        endsAt: LATEST(),
        location: LATEST(),
        notes: LATEST(),
        attending: EVERY(),
      },
      ["title", "startsAt", "endsAt", "location", "notes"],
      expandedGatherJson({ role: "attending", schema: "ShallowPerson", reading: "ShallowPerson" }),
      { attending: { role: "attending", reciprocal: { role: "attends", context: "attending" } } },
    ),
  },
  {
    name: "note",
    summary: "a captured thought — a title, a body, and tags",
    registration: plain("Note", { title: LATEST(), body: LATEST(), tags: EVERY() }, [
      "title",
      "body",
      "tags",
    ]),
  },
  {
    name: "org",
    summary: "an organization — a name, a description, a website, and members read shallow",
    registration: plain(
      "Org",
      { name: LATEST(), description: LATEST(), website: LATEST(), members: EVERY() },
      ["name", "description", "website"],
      expandedGatherJson({ role: "members", schema: "ShallowPerson", reading: "ShallowPerson" }),
      { members: { role: "members", reciprocal: { role: "memberOf", context: "memberOf" } } },
    ),
  },
  {
    name: "person",
    summary: "somebody — a name, a bio, a way to reach them, and who they follow",
    registration: plain(
      "Person",
      { name: LATEST(), bio: LATEST(), email: LATEST(), follows: EVERY() },
      ["name", "bio", "email"],
      entityGatherJson(),
      { follows: { role: "follows", reciprocal: { role: "followedBy", context: "followers" } } },
    ),
  },
  {
    name: "post",
    summary: "something published — a title, a body, when it went out, and tags",
    registration: plain(
      "Post",
      { title: LATEST(), body: LATEST(), publishedAt: LATEST(), tags: EVERY() },
      ["title", "body", "publishedAt", "tags"],
    ),
  },
  {
    name: "shallow-person",
    summary: "a person read shallow — the name alone, for nesting inside other views",
    registration: plain("ShallowPerson", { name: LATEST() }, ["name"], shallowGatherJson(["name"])),
  },
]);

export const stockNames = (): readonly string[] => STOCK_SCHEMAS.map((s) => s.name);

export const stockSchema = (name: string): StockSchema | undefined =>
  STOCK_SCHEMAS.find((s) => s.name === name);
