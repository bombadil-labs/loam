// T153 item 1 — respond.ts's own header test. The agreed core is the point: the JSON content-type
// must not drift again (T143 proved the copies could disagree in ways that matter), and a call site
// must not be able to override it. Asserted at the OBJECT level — a real server, a real response —
// so the module's promise is what the bytes say, not what the file spells.
//
// DOOR BINDING, NAMED: this file pins the core, and the source scan below pins that the three doors
// with JSON writers still CALL the core — a door that stops delegating would otherwise go red
// nowhere. The scan is textual (the T143 pattern): the doors' own policy literals stay per-door by
// frozen design, so the scan counts `endJson(` call sites, not policy spellings.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { endJson } from "../../src/server/respond.js";

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length > 0) await new Promise<void>((r) => servers.pop()!.close(() => r()));
});

async function jsonAnswer(headers: Record<string, string>): Promise<Response> {
  const server = createServer((_req, res) => endJson(res, 200, { ok: true }, headers));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  return fetch(`http://127.0.0.1:${port}`);
}

describe("respond.endJson writes the agreed core", () => {
  it("the content-type spelling never drifts", async () => {
    const res = await jsonAnswer({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("the core WINS: a call site cannot override the agreed content-type", async () => {
    const res = await jsonAnswer({ "content-type": "text/plain" });
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("the door's cache policy rides through at the call site", async () => {
    const res = await jsonAnswer({ "cache-control": "no-store" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    // The core itself forces nothing: an http-door answer keeps its pre-consolidation cacheability.
    const plain = await jsonAnswer({});
    expect(plain.headers.get("cache-control")).toBeNull();
  });
});

describe("the doors still call the agreed core", () => {
  it("session, oauth and http each delegate their JSON writers to endJson", () => {
    const root = join(import.meta.dirname, "..", "..", "src", "server");
    for (const file of ["session.ts", "oauth.ts", "http.ts"]) {
      const content = readFileSync(join(root, file), "utf8");
      expect(
        content.split("endJson(").length - 1,
        `${file} delegates its JSON writers to endJson`,
      ).toBeGreaterThan(0);
    }
  });
});
