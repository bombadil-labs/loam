import { authorForSeed, signClaims, type Primitive } from "@bombadil/rhizomatic";
import { toWire, type WireDelta } from "../federation/wire.js";

export { authorForSeed };
export type { WireDelta };

export function mintSeed(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
  readonly url: string;
  readonly token?: string;
  readonly seed?: string;
  readonly fetch?: typeof fetch;
}

export interface LoamClient {
  readonly author?: string;
  query(source: string, variables?: Record<string, unknown>): Promise<QueryResult>;
  subscribe(source: string): AsyncGenerator<Record<string, unknown>, void, unknown>;
  sign(pointers: readonly ClientPointer[], timestamp?: number): WireDelta;
  append(deltas: readonly WireDelta[]): Promise<AppendReceipt>;
  claim(pointers: readonly ClientPointer[]): Promise<AppendReceipt & { delta: string }>;
}

const asError = async (res: Response, fallback: string): Promise<Error> => {
  try {
    const body = (await res.json()) as { errors?: string[] };
    if (Array.isArray(body.errors) && body.errors.length > 0) {
      return new Error(body.errors.join("; "));
    }
  } catch {}
  return new Error(`${fallback} (HTTP ${res.status})`);
};

export function loamClient(options: LoamClientOptions): LoamClient {
  const base = options.url.replace(/\/$/, "");
  const doFetch: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const seed = options.seed;
  const author = seed === undefined ? undefined : authorForSeed(seed);
  const headers = (json: boolean): Record<string, string> => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
  });

  let lastTs = 0;
  const clientClock = (): number => {
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
    const ts = timestamp ?? clientClock();
    lastTs = Math.max(lastTs, ts);
    return toWire(signClaims({ timestamp: ts, validFrom: ts, author, pointers: mapped }, seed));
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
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary !== null) {
            const frame = buffer.slice(0, boundary.index);
            buffer = buffer.slice(boundary.index + boundary[0].length);
            const data = frame
              .split(/\r?\n/)
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("\n");
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
