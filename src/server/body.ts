import type { IncomingMessage } from "node:http";
import type { Primitive } from "@bombadil/rhizomatic";

export class BodyTooLarge extends Error {
  constructor() {
    super("request body too large");
  }
}

export const readBodyStrict = (req: IncomingMessage, limit: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let overflowed = false;
    req.on("data", (c: Buffer) => {
      if (overflowed) return;
      size += c.length;
      if (size > limit) {
        overflowed = true;
        reject(new BodyTooLarge());
        return;
      }
      chunks.push(c);
    });

    req.on("end", () => {
      if (!overflowed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });

export const readBodyLenient = (req: IncomingMessage, max: number): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > max) {
        over = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(over ? undefined : Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });

export const parseUrlEncoded = (body: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(body)) out.set(k, v);
  return out;
};

export const parseBodyFields = (
  bodyText: string,
  contentType: string | undefined,
): Record<string, Primitive> => {
  const out: Record<string, Primitive> = {};
  if ((contentType ?? "").includes("application/json")) {
    const parsed = JSON.parse(bodyText) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("the write body must be a JSON object of fields");
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
        throw new Error(`field "${k}" wants a primitive (string | number | boolean)`);
      }
      out[k] = v;
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(bodyText)) out[k] = v;
  return out;
};

export const parseLoginBodyFields = (
  body: string | undefined,
  contentType: string | undefined,
): Map<string, string> => {
  const out = new Map<string, string>();
  if (body === undefined) return out;
  if ((contentType ?? "").includes("application/json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === "string") out.set(k, v);
        }
      }
    } catch {
      return out;
    }
    return out;
  }
  for (const [k, v] of new URLSearchParams(body)) out.set(k, v);
  return out;
};
