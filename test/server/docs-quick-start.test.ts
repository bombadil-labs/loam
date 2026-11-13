import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";

vi.setConfig({ testTimeout: 20_000 });

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const OPERATOR_SEED = "0e".repeat(32);

let handle: ServerHandle;
let base: string;

beforeAll(async () => {
  const gateway = await Gateway.open(new MemoryBackend(), { seed: OPERATOR_SEED });
  handle = await serve({
    mounts: { garden: gateway },
    tokens: { "op-token": { operator: true } },
    port: 0,
  });
  base = `http://127.0.0.1:${handle.port}`;
});
afterAll(async () => {
  await handle.close();
});

const rpc = (body: Record<string, unknown>): Promise<Response> =>
  fetch(`${base}/garden/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer op-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  });

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const call = async (args: Record<string, unknown>): Promise<ToolResult> => {
  const res = await rpc({ method: "tools/call", params: { name: "loam_docs", arguments: args } });
  return ((await res.json()) as { result: ToolResult }).result;
};

describe("T250 (a) — the quick-start is listed and served", () => {
  it("the listing names quick-start with its summary; the doc covers the four movements", async () => {
    const listing = await call({});
    expect(listing.isError).not.toBe(true);
    const text = listing.content[0]!.text;
    expect(text).toContain("quick-start");
    expect(text).toContain("the guided init");
    expect(text).not.toContain("npm i -g");

    const doc = await call({ topic: "quick-start" });
    expect(doc.isError).not.toBe(true);
    const md = doc.content[0]!.text;
    expect(md).toContain("npm i -g @bombadil/loam");
    expect(md).toContain("loam init --home");
    expect(md).toContain("tailscale funnel");
    expect(md).toContain("/default/mcp");
    expect(md).toContain("--public-url");
    expect(md).toContain("--oauth-allow-redirect https://claude.ai");
    expect(md).toContain("an unlockable door is a wall");
  });
});

describe("T250 (b) — the topic-character guard, red at the second doc as owed", () => {
  it("a filename minting a topic outside [a-z0-9-]+ refuses the build; the live topics pass", () => {
    const bad = join(root, "docs", "Bad_Topic.md");
    writeFileSync(bad, "# never served\n");
    try {
      let refusal = "";
      try {
        execFileSync(process.execPath, [join(root, "scripts", "build-docs.mjs"), "--check"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        refusal = String((err as { stderr?: string }).stderr ?? err);
      }
      expect(refusal).toContain('topic "Bad_Topic"');
      expect(refusal).toContain("[a-z0-9-]+");
    } finally {
      rmSync(bad, { force: true });
    }
    const ok = execFileSync(
      process.execPath,
      [join(root, "scripts", "build-docs.mjs"), "--check"],
      { cwd: root, encoding: "utf8" },
    );
    expect(ok).toContain("byte-identical");
  });
});

describe("T250 (c) — parity: the tool, the resource, and the file agree", () => {
  it("served bytes equal docs/quick-start.md, and the resource serves the same bytes", async () => {
    const file = readFileSync(join(root, "docs", "quick-start.md"), "utf8");
    const doc = await call({ topic: "quick-start" });
    expect(doc.content[0]!.text).toBe(file);

    const res = await rpc({
      method: "resources/read",
      params: { uri: "loam://docs/quick-start" },
    });
    const body = (await res.json()) as {
      result: { contents: Array<{ uri: string; text: string }> };
    };
    expect(body.result.contents[0]!.uri).toBe("loam://docs/quick-start");
    expect(body.result.contents[0]!.text).toBe(file);
  });
});
