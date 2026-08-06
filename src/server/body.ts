// One capped body reader and one field parser, shared by every door (T153 item 2). Four doors
// grew four copies of the same two ideas; the copies drifted only where they DISAGREE on purpose,
// and this module keeps the disagreement explicit:
//
//   - readBodyStrict REFUSES an oversized body (BodyTooLarge -> 413) and keeps draining the
//     request so the handler can answer cleanly. The REST/yield door's transport contract.
//   - readBodyLenient answers `undefined` past the cap (and on a socket error), so the form
//     gates can speak their own refusal message instead of the transport's. The login/register/
//     federate doors' contract, where a too-big registration is a FORM error, not a transport one.
//
// Each door passes its own cap constant (per-door policy, never module state) and its own parser
// entry point:
//
//   - parseBodyFields: the strict write-door parser — JSON object of primitives, or urlencoded
//     string fields; a malformed body THROWS (the door answers 400 with the reason).
//   - parseLoginBodyFields: the form-door parser — a typo in a password must be a wrong
//     password, never a 503 through the outer guard, so JSON errors swallow to an empty map and
//     non-string values are skipped (session.ts's `formFields`, moved verbatim).
//   - parseUrlEncoded: the plain urlencoded-field map (oauth's `readBodyFields`, admin's field
//     loop) — `+` is a space, UTF-8 percent-escapes decode, a mangled escape never throws.

import type { IncomingMessage } from "node:http";
import type { Primitive } from "@bombadil/rhizomatic";

/** The strict reader's refusal (http.ts's transport contract): the door answers 413. */
export class BodyTooLarge extends Error {}

// Read the body as bytes (so a chunk boundary never splits a multibyte character), refusing
// anything past the cap before it can exhaust memory. On overflow we stop buffering and reject,
// but let the request keep draining so the handler can answer with a clean response instead of
// resetting the socket under the client.
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

// The lenient reader: `undefined` past the cap (the body is "absent", the gate refuses with its
// own message) and `undefined` on a socket error — the form doors never 503 a torn connection.
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

/** urlencoded field pairs, decoded the way a browser encodes them; duplicates: last wins. */
export const parseUrlEncoded = (body: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const [k, v] of new URLSearchParams(body)) out.set(k, v);
  return out;
};

// Parse a rendered route's write body (SPEC §23.3): a browser `<form>` POSTs
// `application/x-www-form-urlencoded` (every value a string); a programmatic caller may POST JSON
// (typed primitives, validated like the REST write door). Either yields the field map writeRoute
// signs as the renderer's pen. Throws a plain-English reason the caller answers 400 with.
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
  for (const [k, v] of new URLSearchParams(bodyText)) out[k] = v; // form-urlencoded: values are strings
  return out;
};

// A form POST or a JSON body — both reach the same field map. `URLSearchParams` decodes what
// browsers encode (`+` for space, UTF-8 percent-escapes) and never throws on a mangled escape —
// a typo in a password must be a wrong password, never a 503 through the outer guard.
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
