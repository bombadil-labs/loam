// Normalization (SPEC §8, step 14): divergent dialects are translated, never mutated. There
// are no global standards — a peer's deltas may say the same thing in another shape. The
// wrong moves are rejection (union is union) and mutation (nothing is ever edited). The right
// move is MORE DELTAS: a TRANSLATION is data — an operator-blessed spec pairing a RECOGNIZER
// (a rhizomatic Pred over a candidate delta) with an EMIT template (a pointer skeleton whose
// holes bind from the recognized delta's own pointers) — and one generic pass executes every
// spec: each emission is a canonical-dialect delta signed by the translator, carrying a
// `translates` delta-ref citing its source (the §9 provenance discipline).
//
// The originals persist untouched beside their normalizations; a better spec later is just
// another pass over the same immortal sources. Idempotence is content addressing: an emission
// inherits its SOURCE's timestamp, so the same (spec, source, translator) always mints the
// same delta id, and union swallows re-runs whole. Translations are terminal — a delta that
// carries a `translates` pointer is never itself translated (no chains, no loops).

import {
  authorForSeed,
  evalPred,
  parsePred,
  signClaims,
  type Claims,
  type Delta,
  type Pointer,
  type Pred,
  type Primitive,
  type Reactor,
} from "@bombadil/rhizomatic";
import type { AppendReceipt, Gateway } from "../gateway/gateway.js";
import { lawfulNegated, lawfulSnapshot } from "../gateway/registration.js";

export const CTX_TRANSLATION = "loam.translation";

// One emitted pointer: an entity pointer whose id comes FROM a source pointer's entity (plus a
// literal context), or a primitive copied FROM a source pointer's value (or a fixed literal).
export interface EmitPointerTemplate {
  readonly role: string;
  readonly at?: { readonly from: { readonly role: string } };
  readonly context?: string;
  readonly value?: { readonly from: { readonly role: string } } | Primitive;
}
export interface EmitTemplate {
  readonly pointers: readonly EmitPointerTemplate[];
}

export interface Translation {
  readonly name: string;
  readonly recognize: Pred;
  readonly emit: EmitTemplate;
}

const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

// Validate the emit template's JSON profile — loud, for the publish path.
export function parseEmitTemplate(raw: unknown): EmitTemplate {
  const o = raw as { pointers?: unknown };
  if (
    o === null ||
    typeof o !== "object" ||
    !Array.isArray(o.pointers) ||
    o.pointers.length === 0
  ) {
    throw new Error("an emit template wants { pointers: [...] }, at least one");
  }
  const pointers = o.pointers.map((p: unknown, i: number): EmitPointerTemplate => {
    const t = p as Record<string, unknown>;
    if (t === null || typeof t !== "object" || typeof t["role"] !== "string" || t["role"] === "") {
      throw new Error(`emit pointer ${i}: a pointer names a role`);
    }
    const at = t["at"] as { from?: { role?: unknown } } | undefined;
    const hasAt = at !== undefined;
    const hasValue = t["value"] !== undefined;
    if (hasAt === hasValue) throw new Error(`emit pointer ${i}: exactly one of at/value`);
    if (hasAt) {
      if (
        typeof at?.from?.role !== "string" ||
        typeof t["context"] !== "string" ||
        t["context"] === ""
      ) {
        throw new Error(`emit pointer ${i}: at wants { from: { role } } and a non-empty context`);
      }
      return { role: t["role"], at: { from: { role: at.from.role } }, context: t["context"] };
    }
    const value = t["value"];
    const hole = value as { from?: { role?: unknown } };
    if (typeof hole === "object" && hole !== null) {
      if (typeof hole.from?.role !== "string") {
        throw new Error(`emit pointer ${i}: value hole wants { from: { role } }`);
      }
      return { role: t["role"], value: { from: { role: hole.from.role } } };
    }
    if (!isPrimitive(value))
      throw new Error(`emit pointer ${i}: a literal value must be a primitive`);
    return { role: t["role"], value };
  });
  return { pointers };
}

// A recognizer must be RUNNABLE by a bare evalPred: no inView (needs lowering), no aliased
// matches (need expansion), no holes (need bindings), no {var: "root"} (there is no root
// here) — parsePred accepts all four, evalPred THROWS on each, and one such spec would kill
// every future translate() pass for every source. Refused structurally, on the JSON form:
// those constructs only ever appear as object KEYS, so key-walking cannot false-positive on
// constant strings.
const UNRUNNABLE_KEYS = new Set(["inView", "aliased", "hole", "var"]);
function assertRunnableRecognizer(raw: unknown, path = "recognize"): void {
  if (Array.isArray(raw)) {
    raw.forEach((v, i) => assertRunnableRecognizer(v, `${path}[${i}]`));
    return;
  }
  if (raw === null || typeof raw !== "object") return;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (UNRUNNABLE_KEYS.has(key)) {
      throw new Error(
        `a recognizer must be runnable against a bare delta: "${key}" (at ${path}) needs ` +
          `machinery translate() does not carry`,
      );
    }
    assertRunnableRecognizer(value, `${path}.${key}`);
  }
}

// A translation spec, serialized as one delta at its translation entity. The recognizer and
// template travel as their JSON profiles; both are validated here — loud at publish.
export function translationClaims(
  name: string,
  recognize: unknown,
  emit: unknown,
  author: string,
  timestamp: number,
): Claims {
  parsePred(recognize); // throws on malformed — nothing unparseable rides a spec delta
  assertRunnableRecognizer(recognize); // and nothing evalPred would throw on
  parseEmitTemplate(emit);
  return {
    timestamp,
    author,
    pointers: [
      {
        role: "defines",
        target: { kind: "entity", entity: { id: `translation:${name}`, context: CTX_TRANSLATION } },
      },
      { role: "name", target: { kind: "primitive", value: name } },
      { role: "recognize", target: { kind: "primitive", value: JSON.stringify(recognize) } },
      { role: "emit", target: { kind: "primitive", value: JSON.stringify(emit) } },
    ],
  };
}

const primitive = (claims: Claims, role: string): string | number | boolean | undefined => {
  const p = claims.pointers.find((x) => x.role === role);
  return p?.target.kind === "primitive" ? p.target.value : undefined;
};

// Every surviving lawful translation spec — latest per translation entity, the shared
// negation algebra, operator-filtered when governed. A malformed spec binds nothing.
export function readTranslations(reactor: Reactor, operator?: string): Translation[] {
  const negated = lawfulNegated(reactor, operator);
  const latest = new Map<string, { t: Translation; timestamp: number; id: string }>();
  for (const delta of lawfulSnapshot(reactor, operator)) {
    let entity: string | undefined;
    for (const p of delta.claims.pointers) {
      if (p.target.kind === "entity" && p.target.entity.context === CTX_TRANSLATION) {
        entity = p.target.entity.id;
        break;
      }
    }
    if (entity === undefined || negated(delta.id)) continue;
    const name = primitive(delta.claims, "name");
    const recognizeJson = primitive(delta.claims, "recognize");
    const emitJson = primitive(delta.claims, "emit");
    if (
      typeof name !== "string" ||
      typeof recognizeJson !== "string" ||
      typeof emitJson !== "string"
    ) {
      continue;
    }
    let t: Translation;
    try {
      const recognizeRaw: unknown = JSON.parse(recognizeJson);
      assertRunnableRecognizer(recognizeRaw); // defense for hand-planted specs past the door
      t = {
        name,
        recognize: parsePred(recognizeRaw),
        emit: parseEmitTemplate(JSON.parse(emitJson)),
      };
    } catch {
      continue;
    }
    const prior = latest.get(entity);
    const candidate = { t, timestamp: delta.claims.timestamp, id: delta.id };
    if (
      prior === undefined ||
      candidate.timestamp > prior.timestamp ||
      (candidate.timestamp === prior.timestamp && candidate.id > prior.id)
    ) {
      latest.set(entity, candidate);
    }
  }
  return [...latest.values()].map((v) => v.t);
}

// Bind the template's holes from the source delta. A hole whose source pointer is missing, of
// the wrong kind, OR AMBIGUOUS (multiple pointers share the from-role) yields NO emission —
// the recognizer should have been tighter, and a half-translated fact (one viewer of two,
// silently) would be worse than none.
function applyTemplate(template: EmitTemplate, source: Delta): Pointer[] | undefined {
  const out: Pointer[] = [];
  for (const p of template.pointers) {
    if (p.at !== undefined) {
      const matches = source.claims.pointers.filter(
        (sp) => sp.role === p.at!.from.role && sp.target.kind === "entity",
      );
      const src = matches[0];
      if (matches.length !== 1 || src?.target.kind !== "entity") return undefined;
      out.push({
        role: p.role,
        target: { kind: "entity", entity: { id: src.target.entity.id, context: p.context! } },
      });
    } else if (typeof p.value === "object" && p.value !== null) {
      const from = (p.value as { from: { role: string } }).from.role;
      const matches = source.claims.pointers.filter(
        (sp) => sp.role === from && sp.target.kind === "primitive",
      );
      const src = matches[0];
      if (matches.length !== 1 || src?.target.kind !== "primitive") return undefined;
      out.push({ role: p.role, target: { kind: "primitive", value: src.target.value } });
    } else {
      out.push({ role: p.role, target: { kind: "primitive", value: p.value as Primitive } });
    }
  }
  return out;
}

export interface TranslateReport {
  readonly emitted: number; // newly landed this pass (union swallowed the rest)
  readonly matched: number; // (spec, source) pairs the recognizers claimed
  readonly unbound: number; // recognized but untranslatable (a hole missing or ambiguous)
}

// One pass of the generic translator: apply every lawful spec to every surviving,
// lawfully-un-struck delta, emit the canonical renderings, cite the sources, let union dedup
// the re-runs. The translator signs as its own identity and needs its own standing — its
// emissions are ITS assertions about what the foreign deltas mean.
//
// `translates` is a RESERVED ROLE: any delta carrying a translates delta-ref is terminal —
// never itself translated (no chains, no loops). The rule keys on shape, not authorship: a
// source that decorates itself with a translates pointer thereby OPTS OUT of translation.
// That evasion is accepted by design — the alternative (author-scoped skipping) reopens
// two-translator ping-pong, and a source that declares itself a rendering is, at worst,
// telling readers where to look.
export async function translate(
  gateway: Gateway,
  opts: { seed: string },
): Promise<TranslateReport> {
  const specs = readTranslations(gateway.reactor, gateway.operator);
  const author = authorForSeed(opts.seed);
  // Sources the OPERATOR has lawfully struck are not re-rendered: translating a retired fact
  // would resurrect it in the canonical dialect, past every negation that retired it.
  const struck = lawfulNegated(gateway.reactor, gateway.operator);
  const emissions: Delta[] = [];
  let matched = 0;
  let unbound = 0;
  if (specs.length > 0) {
    for (const source of gateway.reactor.snapshot()) {
      const isTranslation = source.claims.pointers.some(
        (p) => p.role === "translates" && p.target.kind === "delta",
      );
      if (isTranslation || struck(source.id)) continue;
      for (const spec of specs) {
        if (!evalPred(spec.recognize, source)) continue;
        matched += 1;
        const pointers = applyTemplate(spec.emit, source);
        if (pointers === undefined) {
          unbound += 1;
          continue;
        }
        emissions.push(
          signClaims(
            {
              timestamp: source.claims.timestamp, // deterministic → same id → idempotent
              author,
              pointers: [
                ...pointers,
                { role: "translates", target: { kind: "delta", deltaRef: { delta: source.id } } },
              ],
            },
            opts.seed,
          ),
        );
      }
    }
  }
  const receipt: AppendReceipt =
    emissions.length > 0 ? await gateway.append(emissions) : { accepted: 0, duplicates: 0 };
  return { emitted: receipt.accepted, matched, unbound };
}
