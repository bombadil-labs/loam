// Scratch (not for merge): test/federation/drop-cli.test.ts's peer + open, with the event loop
// stalled 6 s between seeding the peer and pulling from it. FIXTURE_CLOSE=1 sends the seeding POST
// with `connection: close`, as the fixed fixture does.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";
const said: string[] = [];
const io = () => ({ out: (s: string) => said.push(s), err: (s: string) => said.push(s) });
it(`a pull after a 6 s stall (fixture close=${process.env.FIXTURE_CLOSE ?? "0"})`, async () => {
  const root = mkdtempSync(join(tmpdir(), "stalled-"));
  const home = join(root, "alice"), me = join(root, "me");
  expect(await run(["init", "--home", home], io())).toBe(0);
  expect(await run(["init", "--home", me], io())).toBe(0);
  expect(await run(["register", "--stock", "note", "--home", home], io())).toBe(0);
  const h = await run(["serve", "--http", "--home", home, "--port", "0", "--token", "t"], io(), { detach: true });
  if (typeof h === "number") throw new Error("serve");
  const res = await fetch(`${h.url}/default/graphql`, {
    method: "POST",
    headers: { authorization: "Bearer t", "content-type": "application/json", ...(process.env.FIXTURE_CLOSE === "1" ? { connection: "close" } : {}) },
    body: JSON.stringify({ query: `mutation { note(entity: "note:a", title: "x") { title } }` }),
  });
  expect(res.ok).toBe(true);
  await new Promise((r) => setTimeout(r, 10));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
  const code = await run(["federate", "open", "--from", `${h.url}/default`, "--into", "friends", "--prefix", "alice", "--token", "t", "--home", me], io());
  await h.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  expect(code, said.join("\n")).toBe(0);
}, 60_000);
