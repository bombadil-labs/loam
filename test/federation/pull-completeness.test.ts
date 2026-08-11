// T60 defect 1 — the pull report accounts for EVERY delta the peer sent. pullFrom drops a wire
// delta that fails reconstruction (deliberate — a live stream may be partially good), but the
// report used to be computed from the post-drop batch: a peer offering 100 deltas of which 40
// would not reconstruct read "offered 60, rejected 0", and because reconstruction fails on the
// peer's BYTES rather than on timing, every later pull repeated the same clean lie (H7).
// Two-sided, both levels: the report names the drops AND the good bystanders land at the delta
// level; a clean offer reports zero drops and prints no damage line.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../../src/cli/cli.js";
import { pullFrom } from "../../src/federation/pull.js";
import { toWire, type WireDelta } from "../../src/federation/wire.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, GARDENER_SEED, observed } from "../spike/garden.js";

const OP_SEED = "0e".repeat(32);

async function local(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP_SEED, registrations: [] }),
  );
}

// Two deltas that reconstruct, one that cannot: its claimed id does not recompute from its
// claims, which is exactly what a delta rotten on the peer's side looks like from here.
function mixedOffer(): { good: WireDelta[]; corrupt: WireDelta; body: string } {
  const good = [
    toWire(observed(FERN, "height", 62, 1000, GARDENER_SEED)),
    toWire(observed(FERN, "height", 63, 2000, GARDENER_SEED)),
  ];
  const corrupt = {
    ...toWire(observed(FERN, "height", 64, 3000, GARDENER_SEED)),
    id: "00".repeat(32),
  };
  return { good, corrupt, body: JSON.stringify({ deltas: [...good, corrupt] }) };
}

const serving = (body: string): ((url: RequestInfo | URL) => Promise<Response>) => {
  return () => Promise.resolve(new Response(body, { status: 200 }));
};

describe("the pull report accounts for every delta the peer sent", () => {
  it("a mixed offer: drops are counted, offered is what the peer SENT, and the good deltas land", async () => {
    const gw = await local();
    const { good, corrupt, body } = mixedOffer();
    const report = await pullFrom(gw, "http://peer.example/default", "tok", {
      fetch: serving(body),
    });
    // Report level: nothing the peer sent is missing from the accounting.
    expect(report.offered).toBe(3);
    expect(report.unreconstructable).toBe(1);
    expect(report.accepted).toBe(2);
    expect(report.rejected).toBe(0);
    // The invariant, and ONLY this one: offered is what the peer sent, and the drops plus what
    // reached federate account for it. Summing accepted + rejected + held + unreconstructable is
    // NOT an identity — those mix unique ids with occurrences (the duplicate case below proves
    // it), so the rail must not freeze a false one in the act of fixing a false report.
    expect(report.offered - report.unreconstructable).toBe(2);
    // Delta level: the good bystanders are IN the store, the unreconstructable one is not.
    const ids = new Set([...gw.reactor.snapshot()].map((d) => d.id));
    for (const w of good) expect(ids.has(w.id)).toBe(true);
    expect(ids.has(corrupt.id)).toBe(false);
    // And nothing carrying the corrupt delta's CLAIM landed under some other id: the drop is
    // real, not just an id the store could never have minted.
    const heights = [...gw.reactor.snapshot()].flatMap((d) =>
      d.claims.pointers.filter((p) => p.role === "height" && p.target.kind === "primitive"),
    );
    expect(heights.map((p) => (p.target as { value: unknown }).value)).not.toContain(64);
    await gw.close();
  });

  // The CLI cue offers two cures because fromWire refuses two different things. The mixed offer
  // above drives the id-mismatch kind; this drives the OTHER kind, so neither half of the message
  // is a promise the code has never kept. A pointer whose target shape this rhizomatic does not
  // know is exactly what a peer on a newer version sends, and H5 makes parseClaims fail closed.
  it("a claim shape this loam cannot read counts as unreconstructable too, and does not throw", async () => {
    const gw = await local();
    const sound = toWire(observed(FERN, "height", 62, 1000, GARDENER_SEED));
    const future = JSON.parse(JSON.stringify(sound)) as WireDelta & {
      claims: { pointers: { role: string; target: unknown }[] };
    };
    future.claims.pointers = [
      { role: "height", target: { kind: "tomorrow", something: "this loam has never seen" } },
    ];
    const report = await pullFrom(gw, "http://peer.example/default", "tok", {
      fetch: serving(JSON.stringify({ deltas: [sound, future] })),
    });
    // Counted, not thrown: the sound delta still lands and the peer is not declared unreachable.
    expect(report.unreconstructable).toBe(1);
    expect(report.offered).toBe(2);
    expect(report.accepted).toBe(1);
    expect(new Set([...gw.reactor.snapshot()].map((d) => d.id)).has(sound.id)).toBe(true);
    await gw.close();
  });

  it("a peer that repeats a delta: offered still counts every occurrence it sent", async () => {
    const gw = await local();
    const { good, corrupt } = mixedOffer();
    const twice = JSON.stringify({ deltas: [good[0], good[0], corrupt] });
    const report = await pullFrom(gw, "http://peer.example/default", "tok", {
      fetch: serving(twice),
    });
    expect(report.offered).toBe(3); // occurrences, not unique ids
    expect(report.unreconstructable).toBe(1);
    expect(report.offered - report.unreconstructable).toBe(2);
    // The dimensions genuinely differ here: one unique delta was newly ingested, so the four
    // numbers do NOT sum to offered. Asserted, so nobody re-derives the identity from a
    // duplicate-free fixture and freezes it back in.
    expect(report.accepted).toBe(1);
    expect(report.accepted + report.rejected + report.held + report.unreconstructable).toBe(2);
    await gw.close();
  });

  it("the failure is a property of the peer's bytes: a second pull reports the SAME drop, not a heal", async () => {
    const gw = await local();
    const { body } = mixedOffer();
    await pullFrom(gw, "http://peer.example/default", "tok", { fetch: serving(body) });
    const again = await pullFrom(gw, "http://peer.example/default", "tok", {
      fetch: serving(body),
    });
    expect(again.unreconstructable).toBe(1);
    expect(again.accepted).toBe(0); // union is idempotent — the good ones are already held
    expect(again.held).toBe(2);
    await gw.close();
  });

  it("the other side: a clean offer reports zero unreconstructable, and so does federate itself", async () => {
    const gw = await local();
    const { good } = mixedOffer();
    const clean = await pullFrom(gw, "http://peer.example/default", "tok", {
      fetch: serving(JSON.stringify({ deltas: good })),
    });
    expect(clean.unreconstructable).toBe(0);
    expect(clean.accepted).toBe(2);
    // federate is handed live deltas — reconstruction cannot fail there, so the count lives on
    // PullReport ONLY and federate's report shape stays exactly what T64's rails froze.
    const direct = await gw.federate([observed(FERN, "height", 65, 4000, GARDENER_SEED)]);
    expect("unreconstructable" in direct).toBe(false);
    await gw.close();
  });
});

describe("loam pull names the drops (the door the operator actually reads)", () => {
  let dir: string;
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  async function serve(body: string): Promise<string> {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    // The lane's port range is 6040-6049; walk it so a parallel lane never collides.
    for (let port = 6040; port <= 6049; port += 1) {
      try {
        await new Promise<void>((resolve, reject) => {
          server!.once("error", reject);
          server!.listen(port, "127.0.0.1", () => {
            server!.removeAllListeners("error");
            resolve();
          });
        });
        return `http://127.0.0.1:${port}/default`;
      } catch {
        // in use — try the next one
      }
    }
    throw new Error("no free port in 6040-6049");
  }

  it("a damaged offer is said out loud; a clean one is not accused", async () => {
    dir = mkdtempSync(join(tmpdir(), "loam-pull-complete-"));
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    const { body, good } = mixedOffer();
    const url = await serve(body);
    const code = await run(["pull", url, "--home", join(dir, "h"), "--token", "tok"], io);
    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/2 accepted, 0 refused, of 3 offered/);
    expect(err.join("\n")).toMatch(/1 of the offered deltas would not reconstruct/);
    expect(err.join("\n")).toMatch(/pulling again drops the same ones/);
    // And it does NOT prescribe a cause it never verified: fromWire refuses a rotted delta and
    // an unreadable claim shape alike, so the line offers both cures or it is overclaiming.
    expect(err.join("\n")).toMatch(/newer delta shape/);
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    // The bystander side: a clean offer earns no damage line.
    out.length = 0;
    err.length = 0;
    const cleanUrl = await serve(JSON.stringify({ deltas: good }));
    const clean = await run(["pull", cleanUrl, "--home", join(dir, "h2"), "--token", "tok"], io);
    expect(clean).toBe(0);
    expect(out.join("\n")).toMatch(/2 accepted, 0 refused, of 2 offered/);
    expect(err.join("\n")).not.toMatch(/would not reconstruct/);
    // And the FILE door, both sides. A clean file pulls and is not accused.
    out.length = 0;
    err.length = 0;
    const file = join(dir, "offer.json");
    writeFileSync(file, JSON.stringify({ deltas: good }));
    expect(await run(["pull", file, "--home", join(dir, "h3")], io)).toBe(0);
    expect(out.join("\n")).toMatch(/2 accepted, 0 refused, of 2 offered/);
    expect(err.join("\n")).not.toMatch(/would not reconstruct/);
    // A DAMAGED file is refused WHOLE — that is why the file branch can honestly hard-code the
    // count at zero. Assert the refusal rather than trusting the comment: nothing lands, the
    // exit is nonzero, and no partial-drop line is printed, because there was no partial pull.
    out.length = 0;
    err.length = 0;
    const badFile = join(dir, "damaged.json");
    const { corrupt } = mixedOffer();
    writeFileSync(badFile, JSON.stringify({ deltas: [...good, corrupt] }));
    const h4 = join(dir, "h4");
    expect(await run(["pull", badFile, "--home", h4], io)).toBe(2);
    expect(err.join("\n")).toMatch(/does not recompute from its claims/);
    expect(err.join("\n")).not.toMatch(/would not reconstruct/);
    expect(out.join("\n")).not.toMatch(/accepted/);
    // Object level for "nothing lands": the refusal happens before the home is even minted, so
    // the good deltas that shared the damaged file are nowhere on disk. Asserted, not assumed.
    expect(existsSync(h4)).toBe(false);
  });
});
