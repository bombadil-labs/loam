// T153 item 1 — respond.ts's own header test. The agreed core is the point: the content-type
// and no-store cache headers must not drift again (T143 proved the copies could disagree in ways
// that matter). Asserted at the OBJECT level — a real server, a real response — so the module's
// promise is what the bytes say, not what the file spells.

import { createServer, type Server } from "node:http";
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
  it("the content-type and cache-control spellings never drift", async () => {
    const res = await jsonAnswer({});
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("the door's policy rides through at the call site", async () => {
    const res = await jsonAnswer({ "referrer-policy": "no-referrer" });
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
