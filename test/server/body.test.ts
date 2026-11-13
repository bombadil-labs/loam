import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  BodyTooLarge,
  parseBodyFields,
  parseLoginBodyFields,
  parseUrlEncoded,
  readBodyLenient,
  readBodyStrict,
} from "../../src/server/body.js";

class FakeReq extends EventEmitter {
  url = "/";
  method = "POST";
}

const data = (req: FakeReq, ...chunks: Buffer[]) => {
  for (const chunk of chunks) req.emit("data", chunk);
  req.emit("end");
};
const die = (req: FakeReq, err: Error) => {
  req.emit("error", err);
};

describe("T153 — readBodyStrict refuses past the cap (the 413 transport contract)", () => {
  it("answers the text within the cap, assembled across chunks", async () => {
    const req = new FakeReq();
    const p = readBodyStrict(req as unknown as IncomingMessage, 16);
    data(req, Buffer.from("hel"), Buffer.from("lo"));
    await expect(p).resolves.toBe("hello");
  });

  it("rejects with BodyTooLarge the moment the cap is crossed", async () => {
    const req = new FakeReq();
    const p = readBodyStrict(req as unknown as IncomingMessage, 4);
    data(req, Buffer.from("hello"));
    await expect(p).rejects.toBeInstanceOf(BodyTooLarge);
  });
});

describe("T153 — readBodyLenient answers undefined past the cap (the form-gate contract)", () => {
  it("resolves the text within the cap", async () => {
    const req = new FakeReq();
    const p = readBodyLenient(req as unknown as IncomingMessage, 16);
    data(req, Buffer.from("hello"));
    await expect(p).resolves.toBe("hello");
  });

  it("resolves undefined past the cap, and on a socket error", async () => {
    const req = new FakeReq();
    const p = readBodyLenient(req as unknown as IncomingMessage, 4);
    data(req, Buffer.from("hello"));
    await expect(p).resolves.toBeUndefined();

    const req2 = new FakeReq();
    const p2 = readBodyLenient(req2 as unknown as IncomingMessage, 16);
    die(req2, new Error("ECONNRESET"));
    await expect(p2).resolves.toBeUndefined();
  });
});

describe("T153 — parseUrlEncoded decodes the browser form shape", () => {
  it("decodes + as space and UTF-8 escapes, duplicates last-win", () => {
    expect([...parseUrlEncoded("a=1&b=x%20y&b=2")]).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(parseUrlEncoded("")).toEqual(new Map());
  });
});

describe("T153 — parseBodyFields is the strict write-door parse", () => {
  it("yields primitives from JSON, and string values from a urlencoded body", () => {
    expect(parseBodyFields('{"a":"x","n":3,"ok":true}', "application/json")).toEqual({
      a: "x",
      n: 3,
      ok: true,
    });
    expect(parseBodyFields("a=x&b=y", undefined)).toEqual({ a: "x", b: "y" });
  });

  it("throws a plain reason for a non-object JSON body or a non-primitive value", () => {
    expect(() => parseBodyFields("[1]", "application/json")).toThrow(
      "the write body must be a JSON object of fields",
    );
    expect(() => parseBodyFields('{"a":{"nested":1}}', "application/json")).toThrow(
      'field "a" wants a primitive',
    );
  });
});

describe("T153 — parseLoginBodyFields is the login-door parse (fail soft)", () => {
  it("swallows mangled JSON to an empty map, skips non-string values, and decodes forms", () => {
    expect(parseLoginBodyFields("{not json", "application/json")).toEqual(new Map());
    expect(parseLoginBodyFields('{"a":"x","n":3}', "application/json")).toEqual(
      new Map([["a", "x"]]),
    );
    expect(parseLoginBodyFields(undefined, undefined)).toEqual(new Map());
    expect(parseLoginBodyFields("u=a&p=b", "application/x-www-form-urlencoded")).toEqual(
      new Map([
        ["u", "a"],
        ["p", "b"],
      ]),
    );
  });
});
