import {
  authorForSeed,
  evalPred,
  makeNegationClaims,
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
import { lawfulSnapshot } from "../gateway/lawful.js";
import { negatedAt } from "../gateway/negation.js";
import { dataStruck } from "../gateway/accounts.js";
import { keysEverOf } from "../gateway/principal.js";
import { promotionRefusal } from "../gateway/adopt.js";

export const CTX_TRANSLATION = "loam.translation";

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

export function translationClaims(
  name: string,
  recognize: unknown,
  emit: unknown,
  author: string,
  timestamp: number,
): Claims {
  parsePred(recognize);
  assertRunnableRecognizer(recognize);
  parseEmitTemplate(emit);
  return {
    timestamp,
    validFrom: timestamp,
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

export function readTranslations(reactor: Reactor, now: number, operator?: string): Translation[] {
  const negated = negatedAt(reactor, now, operator);
  const latest = new Map<string, { t: Translation; timestamp: number; id: string }>();
  for (const delta of lawfulSnapshot(reactor, now, operator)) {
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
      assertRunnableRecognizer(recognizeRaw);
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
  readonly emitted: number;
  readonly matched: number;
  readonly unbound: number;
  readonly refused: number;
  readonly retracted?: number;
  readonly stranded?: number;
}

export async function translate(
  gateway: Gateway,
  opts: { seed: string },
): Promise<TranslateReport> {
  const specs = readTranslations(gateway.reactor, gateway.validityNow(), gateway.operator);
  const author = authorForSeed(opts.seed);
  const struck = dataStruck(gateway.reactor, gateway.validityNow(), gateway.operator);
  const emissions: Delta[] = [];
  let matched = 0;
  let unbound = 0;
  let refused = 0;
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
        const emitted: Pointer[] = [
          ...pointers,
          { role: "translates", target: { kind: "delta", deltaRef: { delta: source.id } } },
        ];
        if (
          promotionRefusal({
            timestamp: source.claims.timestamp,
            validFrom: source.claims.timestamp,
            author,
            pointers: emitted,
          })
        ) {
          refused += 1;
          continue;
        }
        emissions.push(
          signClaims(
            {
              timestamp: source.claims.timestamp,
              validFrom: source.claims.timestamp,
              author,
              pointers: emitted,
            },
            opts.seed,
          ),
        );
      }
    }
  }
  const retractions: Delta[] = [];
  const mine = keysEverOf(
    gateway.reactor,
    gateway.validityNow(),
    { root: author },
    gateway.operator,
  );
  let stranded = 0;
  for (const held of gateway.reactor.snapshot()) {
    if (struck(held.id)) continue;
    const cite = held.claims.pointers.find(
      (p) => p.role === "translates" && p.target.kind === "delta",
    );
    if (cite?.target.kind !== "delta" || !struck(cite.target.deltaRef.delta)) continue;
    if (!mine.has(held.claims.author)) {
      stranded += 1;
      continue;
    }
    retractions.push(
      signClaims(makeNegationClaims(author, held.claims.timestamp, held.id), opts.seed),
    );
  }
  const nothing: AppendReceipt = { accepted: 0, duplicates: 0 };
  const retractReceipt = retractions.length > 0 ? await gateway.append(retractions) : nothing;
  const emitReceipt = emissions.length > 0 ? await gateway.append(emissions) : nothing;
  return {
    emitted: emitReceipt.accepted,
    matched,
    unbound,
    refused,
    ...(retractReceipt.accepted > 0 ? { retracted: retractReceipt.accepted } : {}),
    ...(stranded > 0 ? { stranded } : {}),
  };
}
