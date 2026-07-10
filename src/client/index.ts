// The browser client (SPEC §12) — `@bombadil/loam/client`. Non-custodial by construction:
// the seed is minted in the page, every delta is signed in the page, and the server never
// holds the key. The bearer token (when one is carried at all) authenticates TRANSPORT only;
// the delta's own verified author is the authority the door asks about. Public reads carry
// nothing at all.
//
// Ships as a self-contained browser bundle: rhizomatic's signing/hashing are pure JS
// (`@noble/curves`, `@noble/hashes`) and are inlined by scripts/build-client.mjs, with the
// substrate's node-only peer transport aliased away (test/client/bundle.test.ts holds the
// line: zero `node:` specifiers). Everything here speaks only `fetch` and
// `globalThis.crypto` — present in every browser and in Node ≥ 18 alike.

import { authorForSeed, signClaims, type Primitive } from "@bombadil/rhizomatic";
import { toWire, type WireDelta } from "../federation/wire.js";

export { authorForSeed };
export type { WireDelta };

// A 32-byte signing seed, minted where it will live: the page. It never travels; show the
// AUTHOR around instead (authorForSeed).
export function mintSeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One concrete pointer of a claim: either an entity pointer (at + context) or a primitive
// (value) — exactly one of the two, the same shape the gateway's `_claim` speaks.
export interface ClientPointer {
  readonly role: string;
  readonly at?: string;
  readonly context?: string;
  readonly value?: Primitive;
}

export interface QueryResult {
  data?: Record<string, unknown> | null;
  errors?: string[];
}

export interface AppendReceipt {
  readonly accepted: number;
  readonly duplicates: number;
}

export interface LoamClientOptions {
  readonly url: string; // the mount: http(s)://host:port/<mount>
  readonly token?: string; // transport bearer; omit for the public read path
  readonly seed?: string; // the page's signing identity; omit for a read-only client
  readonly fetch?: typeof fetch; // injectable for tests; defaults to the global
}

export interface LoamClient {
  // The author this client signs as — undefined when no seed was given.
  readonly author?: string;
  // GraphQL over POST: returns { data, errors } exactly as the gateway answers.
  query(source: string, variables?: Record<string, unknown>): Promise<QueryResult>;
  // GraphQL subscription over SSE: an async stream of data payloads. return() hangs up.
  subscribe(source: string): AsyncGenerator<Record<string, unknown>, void, unknown>;
  // Sign one delta locally — the seed never leaves the page. Timestamps are strictly
  // monotonic within this client, so its own claims never tie.
  sign(pointers: readonly ClientPointer[], timestamp?: number): WireDelta;
  // Present signed deltas at the non-custodial door (POST /append). Throws with the door's
  // reason on refusal.
  append(deltas: readonly WireDelta[]): Promise<AppendReceipt>;
  // sign + append, one call: the receipt carries the delta id that landed.
  claim(pointers: readonly ClientPointer[]): Promise<AppendReceipt & { delta: string }>;
}

const asError = async (res: Response, fallback: string): Promise<Error> => {
  try {
    const body = (await res.json()) as { errors?: string[] };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return new Error(body.errors.join("; "));
    }
  } catch {
    // an unreadable refusal falls through to the status line
  }
  return new Error(`${fallback} (HTTP ${res.status})`);
};

export function loamClient(options: LoamClientOptions): LoamClient {
  const base = options.url.replace(/\/$/, "");
  // Wrapped rather than aliased: an extracted `fetch` reference is this-sensitive in some
  // browsers ("illegal invocation"); a fresh arrow keeps the global receiver.
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const seed = options.seed;
  const author = seed === undefined ? undefined : authorForSeed(seed);
  const headers = (json: boolean): Record<string, string> => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
  });

  // Strictly monotonic within this client — the same discipline the gateway keeps.
  let lastTs = 0;
  const nextTimestamp = (): number => {
    lastTs = Math.max(Date.now(), lastTs + 1);
    return lastTs;
  };

  const sign = (pointers: readonly ClientPointer[], timestamp?: number): WireDelta => {
    if (seed === undefined || author === undefined) {
      throw new Error("this client holds no seed and cannot sign — pass { seed } to write");
    }
    if (pointers.length === 0) {
      throw new Error("a claim carries at least one pointer");
    }
    const mapped = pointers.map((p, i) => {
      if (typeof p.role !== "string" || p.role === "") {
        throw new Error(`claim pointer ${i}: a pointer names a role`);
      }
      const hasAt = p.at !== undefined;
      if (hasAt === (p.value !== undefined)) {
        throw new Error(`claim pointer ${i} ("${p.role}"): exactly one of at/value`);
      }
      if (hasAt) {
        if (p.at === "" || p.context === undefined || p.context === "") {
          throw new Error(
            `claim pointer ${i} ("${p.role}"): an entity pointer wants an id and a context`,
          );
        }
        return {
          role: p.role,
          target: { kind: "entity" as const, entity: { id: p.at, context: p.context } },
        };
      }
      return { role: p.role, target: { kind: "primitive" as const, value: p.value as Primitive } };
    });
    return toWire(
      signClaims({ timestamp: timestamp ?? nextTimestamp(), author, pointers: mapped }, seed),
    );
  };

  const append = async (deltas: readonly WireDelta[]): Promise<AppendReceipt> => {
    const res = await doFetch(`${base}/append`, {
      method: "POST",
      headers: headers(true),
      body: JSON.stringify({ deltas }),
    });
    if (!res.ok) throw await asError(res, "the append door refused");
    return (await res.json()) as AppendReceipt;
  };

  return {
    ...(author === undefined ? {} : { author }),

    async query(source, variables) {
      const res = await doFetch(`${base}/graphql`, {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ query: source, ...(variables ? { variables } : {}) }),
      });
      if (!res.ok) throw await asError(res, "the query was refused");
      return (await res.json()) as QueryResult;
    },

    // SSE over fetch, not EventSource: EventSource cannot carry an authorization header, and
    // this parser runs identically in the page and in Node. One `data:` frame per payload
    // (the server promises JSON.stringify never emits a raw newline); an `event: error` frame
    // becomes the thrown reason.
    subscribe(source) {
      const url = `${base}/subscribe?query=${encodeURIComponent(source)}`;
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

      const frames = (async function* (): AsyncGenerator<Record<string, unknown>, void, unknown> {
        const res = await doFetch(url, {
          headers: { accept: "text/event-stream", ...headers(false) },
          signal: controller.signal,
        });
        if (!res.ok || res.body === null) {
          throw await asError(res, "the subscription was refused");
        }
        const r = res.body.getReader();
        reader = r;
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const boundary = buffer.indexOf("\n\n");
          if (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (data.length === 0) continue;
            if (/^event:\s*error$/m.test(frame)) {
              const reason = JSON.parse(data) as { message?: string };
              throw new Error(reason.message ?? "the stream failed");
            }
            yield JSON.parse(data) as Record<string, unknown>;
            continue;
          }
          const chunk = await r.read();
          if (chunk.done) return;
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      })();

      // Wrap so return()/throw() actually hang up the socket — a suspended generator would
      // otherwise hold the connection until the next event woke it.
      const hangUp = async (): Promise<void> => {
        controller.abort();
        await reader?.cancel().catch(() => {});
      };
      return {
        next: () => frames.next(),
        async return(): Promise<IteratorResult<Record<string, unknown>, void>> {
          await hangUp();
          await frames.return(undefined).catch(() => {});
          return { value: undefined, done: true };
        },
        async throw(error?: unknown): Promise<IteratorResult<Record<string, unknown>, void>> {
          await hangUp();
          throw error instanceof Error ? error : new Error(String(error));
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },

    sign,
    append,

    async claim(pointers) {
      const delta = sign(pointers);
      const receipt = await append([delta]);
      return { ...receipt, delta: delta.id };
    },
  };
}
