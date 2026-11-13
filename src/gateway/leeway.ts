export type EnvelopeSize = "small" | "medium" | "large";

const ENVELOPE_RANK: Readonly<Record<EnvelopeSize, number>> = { small: 1, medium: 2, large: 3 };

export const smallerEnvelope = (a: EnvelopeSize, b: EnvelopeSize): EnvelopeSize =>
  ENVELOPE_RANK[a] <= ENVELOPE_RANK[b] ? a : b;

const SWITCHES = ["receive", "offer", "publish"] as const;
type Switch = (typeof SWITCHES)[number];

interface Allowances {
  readonly receive: boolean;
  readonly offer: boolean;
  readonly publish: boolean;
  readonly envelope: EnvelopeSize;
}

export interface Terms extends Allowances {
  readonly delegate: "off" | "same" | Terms;
}

export interface Leeway extends Allowances {
  readonly delegate: "off" | Terms;
}

export interface LeewayRefusal {
  readonly why: string;
}

export function leewayFits(child: Leeway, parent: Leeway): LeewayRefusal | undefined {
  if (parent.delegate === "off") {
    return {
      why:
        "this container delegates nothing, so its subtree is a pure namespace: every child " +
        "inherits its leeway exactly and none may declare one of its own. Turn Delegate on and " +
        "set the terms a child may differ within.",
    };
  }
  return fitsWithin(child, parent.delegate);
}

function fitsWithin(
  child: Allowances & { readonly delegate: "off" | "same" | Terms },
  allowed: Terms,
): LeewayRefusal | undefined {
  for (const name of SWITCHES) {
    if (child[name] && !allowed[name]) {
      return { why: refusedSwitch(name) };
    }
  }
  if (ENVELOPE_RANK[child.envelope] > ENVELOPE_RANK[allowed.envelope]) {
    return {
      why:
        `the envelope "${child.envelope}" is above the ceiling "${allowed.envelope}" these terms ` +
        `set. Choose ${allowed.envelope} or smaller, or raise the ceiling where the terms are written.`,
    };
  }

  const wanted = child.delegate;
  if (wanted === "off") return undefined;

  const permitted = allowed.delegate;
  if (permitted === "off") {
    return {
      why:
        "these terms delegate nothing further, so a child here may not set terms of its own. " +
        "Everything below it inherits its leeway exactly.",
    };
  }

  const ceiling: Terms = permitted === "same" ? allowed : permitted;

  if (wanted === "same") {
    return permitted === "same" ? undefined : fitsWithin(child, ceiling);
  }

  return fitsWithin(wanted, ceiling);
}

function refusedSwitch(name: Switch): string {
  const act = {
    receive: "follow other stores",
    offer: "be followed by other stores",
    publish: "publish to the internet",
  }[name];
  return (
    `these terms do not allow a child to ${act}, so "${name}" may not be turned on below here. ` +
    `Turn ${name} on in the delegation terms first, where the person who set them can read what ` +
    `it gives away.`
  );
}

export const SEALED_LEEWAY: Leeway = {
  receive: false,
  offer: false,
  publish: false,
  envelope: "small",
  delegate: "off",
};

const MAX_TERMS_DEPTH = 32;

const ENVELOPE_NAMES: ReadonlySet<string> = new Set<EnvelopeSize>(["small", "medium", "large"]);
const LEEWAY_KEYS: ReadonlySet<string> = new Set([...SWITCHES, "envelope", "delegate"]);

export function parseLeeway(raw: string): { leeway: Leeway } | { defect: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { defect: "the declared leeway is not parseable JSON" };
  }

  const allowances = readAllowances(parsed);
  if (typeof allowances === "string") return { defect: allowances };
  const delegate = (parsed as Record<string, unknown>).delegate;
  if (delegate === "off") {
    return canonical(raw, parsed) ?? { leeway: { ...allowances, delegate: "off" } };
  }
  if (delegate === "same") {
    return {
      defect:
        '"same" means "under these very terms", so it belongs inside delegation terms and never ' +
        "on a container's own leeway, where there are no enclosing terms for it to repeat",
    };
  }
  const terms = readTerms(delegate, 1);
  if (typeof terms === "string") return { defect: terms };
  return canonical(raw, parsed) ?? { leeway: { ...allowances, delegate: terms } };
}

function canonical(raw: string, parsed: unknown): { defect: string } | undefined {
  return raw === canonicalLeewayJson(parsed)
    ? undefined
    : {
        defect:
          "the declared leeway is not in canonical form — a leeway is stored with its keys sorted " +
          "and no duplicates, so the bytes at rest say exactly one thing",
      };
}

function readAllowances(value: unknown): Allowances | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "a leeway is an object carrying three switches, an envelope and delegation terms";
  }
  const o = value as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!LEEWAY_KEYS.has(key)) return `the declared leeway carries an unknown key "${key}"`;
  }
  for (const name of SWITCHES) {
    if (typeof o[name] !== "boolean") {
      return `the leeway switch "${name}" is a boolean, and every declaration carries all three`;
    }
  }
  const envelope = o.envelope;
  if (typeof envelope !== "string" || !ENVELOPE_NAMES.has(envelope)) {
    return 'the leeway envelope is "small", "medium" or "large"';
  }
  return {
    receive: o.receive as boolean,
    offer: o.offer as boolean,
    publish: o.publish as boolean,
    envelope: envelope as EnvelopeSize,
  };
}

function readTerms(value: unknown, depth: number): Terms | string {
  if (depth > MAX_TERMS_DEPTH) {
    return `the declared leeway nests deeper than ${MAX_TERMS_DEPTH} levels of terms`;
  }
  const allowances = readAllowances(value);
  if (typeof allowances === "string") return allowances;
  const delegate = (value as Record<string, unknown>).delegate;
  if (delegate === "off" || delegate === "same") return { ...allowances, delegate };
  const inner = readTerms(delegate, depth + 1);
  return typeof inner === "string" ? inner : { ...allowances, delegate: inner };
}

export function isSealed(leeway: Leeway): boolean {
  return (
    !leeway.receive &&
    !leeway.offer &&
    !leeway.publish &&
    leeway.envelope === "small" &&
    leeway.delegate === "off"
  );
}

export function canonicalLeewayJson(value: unknown): string {
  return JSON.stringify(sortKeys(value, 0));
}

function sortKeys(value: unknown, depth: number): unknown {
  if (depth > MAX_TERMS_DEPTH + 2) return "[too deep to canonicalise]";
  if (Array.isArray(value)) return value.map((v) => sortKeys(v, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  const o = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(o).sort()) out[key] = sortKeys(o[key], depth + 1);
  return out;
}
