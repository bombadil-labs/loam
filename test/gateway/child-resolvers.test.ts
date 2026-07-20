// Resolvers reach expanded children (ticket T26, on rhizomatic 0.8 / issue #23). A §22 resolver rides
// a binding and decorates a lens's fields. Once an `expand` names the child's reading (0.8), an
// entity embedded as an expanded child is resolved through its OWN reading — so the child reading's
// resolvers should apply to it too. Before T26 they did not: a post read directly carried its computed
// byline, but the same post embedded in a feed did not (the gap Pachyderm's pachy.2 documented). These
// rails pin the fix: the child, read directly and read as an expansion, resolves to the SAME decorated
// value; a child reading with no resolvers passes through untouched; and the child resolver's memo
// still invalidates when the child's own ground is erased.

import { describe, expect, it } from "vitest";
import { authorForSeed, parseTerm, signClaims, type Delta } from "@bombadil/rhizomatic";
import { operatorMarkerClaims } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const SEED = "9c".repeat(32);
const OP = authorForSeed(SEED);
const SIG6 = OP.slice(-6);

const PICK = {
  kind: "pick" as const,
  order: { kind: "byTimestamp" as const, dir: "desc" as const },
};
const ALL = { kind: "all" as const, order: { kind: "byTimestamp" as const, dir: "asc" as const } };
const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};

// A Post reading whose `text` field is computed: the byline is the author's signature, not typed.
const POST_H = { name: "PostH", alg: 1, body: parseTerm(GATHER) };
const POST_S = { name: "Post", alg: 1, props: new Map([["text", PICK]]), default: PICK };
const ATTRIBUTION = {
  text: {
    code: "export default (bucket) => bucket.map((e) => `${String(e.author).slice(-6)}: ${e.value}`).join(' | ');",
    rung: "a" as const,
    type: "string" as const,
  },
};

// A Feed that expands the `post` role into each post's Post view.
const FEED_H = {
  name: "FeedH",
  alg: 1,
  body: parseTerm({
    op: "expand",
    role: { exact: "post" },
    schema: "PostH",
    reading: "Post",
    in: GATHER,
  }),
};
const FEED_S = { name: "Feed", alg: 1, props: new Map([["post", ALL]]), default: PICK };

const link = (post: string): Delta =>
  signClaims(
    {
      timestamp: 10,
      author: OP,
      pointers: [
        { role: "feed", target: { kind: "entity", entity: { id: "feed:main", context: "post" } } },
        { role: "post", target: { kind: "entity", entity: { id: post, context: "in" } } },
      ],
    },
    SEED,
  );
const say = (post: string, text: string, at: number): Delta =>
  signClaims(
    {
      timestamp: at,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: post, context: "text" } } },
        { role: "text", target: { kind: "primitive", value: text } },
      ],
    },
    SEED,
  );

async function feedGateway(withResolver: boolean): Promise<Gateway> {
  const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
  await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
  await gw.append([link("post:a1"), say("post:a1", "hello", 20)]);
  await gw.publishRegistration(
    POST_H,
    POST_S,
    ["post:a1"],
    undefined,
    undefined,
    undefined,
    ["text"],
    withResolver ? ATTRIBUTION : undefined,
  );
  await gw.publishRegistration(FEED_H, FEED_S, ["feed:main"]);
  return gw;
}

const post0 = (r: { data?: unknown }): Record<string, unknown> =>
  (r.data as { feed: { post: Record<string, unknown>[] } }).feed.post[0]!;

describe("resolvers reach expanded children (T26)", () => {
  it("a post read directly and the same post read as an expanded child resolve to the SAME byline", async () => {
    const gw = await feedGateway(true);
    const direct = await gw.query(`{ post(entity: "post:a1") { text } }`);
    const feed = await gw.query(`{ feed(entity: "feed:main") { post } }`);
    const directText = (direct.data as { post: { text: string } }).post.text;

    // The resolver computed the byline from cryptographic authorship, not from what was typed.
    expect(directText).toBe(`${SIG6}: hello`);
    // ...and the expanded child in the feed carries the IDENTICAL computed byline.
    expect(post0(feed).text).toBe(directText);
    await gw.close();
  });

  it("a child reading with no resolvers passes through untouched (raw text)", async () => {
    const gw = await feedGateway(false);
    const feed = await gw.query(`{ feed(entity: "feed:main") { post } }`);
    expect(post0(feed).text).toBe("hello"); // the Policy value, undecorated
    await gw.close();
  });

  it("the child resolver's memo invalidates when the child's own ground is erased", async () => {
    const gw = await feedGateway(true);
    const before = await gw.query(`{ feed(entity: "feed:main") { post } }`);
    expect(post0(before).text).toBe(`${SIG6}: hello`);

    // Forget the post's text delta: the child's bucket changes, so the child resolver must re-run
    // over the surviving (now empty) ground — the stale byline can never be served again.
    const textDelta = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "hello"),
    );
    await gw.erase(textDelta!.id, { reason: "thought better of it" });
    const after = await gw.query(`{ feed(entity: "feed:main") { post } }`);
    expect(post0(after).text).not.toBe(`${SIG6}: hello`); // the forgotten byline is gone from the child
    await gw.close();
  });
});
