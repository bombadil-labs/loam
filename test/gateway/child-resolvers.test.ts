// Resolvers reach expanded children (ticket T26, on rhizomatic 0.8 / issue #23). A §22 resolver rides
// a binding and decorates a lens's fields. Once an `expand` names the child's reading (0.8), an
// entity embedded as an expanded child is resolved through its OWN reading — so the child reading's
// resolvers should apply to it too. Before T26 they did not: a post read directly carried its computed
// byline, but the same post embedded in a feed did not (the gap Pachyderm's pachy.2 documented). These
// rails pin the fix: the child, read directly and read as an expansion, resolves to the SAME decorated
// value; a child reading with no resolvers passes through untouched; and the child resolver's memo
// still invalidates when the child's own ground is erased.

import { describe, expect, it } from "vitest";
import {
  authorForSeed,
  makeNegationClaims,
  parseTerm,
  signClaims,
  type Delta,
} from "@bombadil/rhizomatic";
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

const FEED_Q = `{ feed(entity: "feed:main") { post } }`;

const post0 = (r: { data?: unknown }): Record<string, unknown> =>
  (r.data as { feed: { post: Record<string, unknown>[] } }).feed.post[0]!;

describe("resolvers reach expanded children (T26)", () => {
  it("a post read directly and the same post read as an expanded child resolve to the SAME byline", async () => {
    const gw = await feedGateway(true);
    const direct = await gw.query(`{ post(entity: "post:a1") { text } }`);
    const feed = await gw.query(FEED_Q);
    const directText = (direct.data as { post: { text: string } }).post.text;

    // The resolver computed the byline from cryptographic authorship, not from what was typed.
    expect(directText).toBe(`${SIG6}: hello`);
    // ...and the expanded child in the feed carries the IDENTICAL computed byline.
    expect(post0(feed).text).toBe(directText);
    await gw.close();
  });

  it("a child reading with no resolvers passes through untouched (raw text)", async () => {
    const gw = await feedGateway(false);
    const feed = await gw.query(FEED_Q);
    expect(post0(feed).text).toBe("hello"); // the Policy value, undecorated
    await gw.close();
  });

  it("the child resolver RE-RUNS when the child's own bucket changes (a retraction, not a reseat)", async () => {
    const gw = await feedGateway(true);
    expect(post0(await gw.query(FEED_Q)).text).toBe(`${SIG6}: hello`);

    // RETRACT the post's text. Deliberately not `erase()`: erasure reseats the gateway, which clears
    // the entire resolver memo (gateway.ts), so an erasure-based test passes even with the memo key
    // reverted to the resolver address alone — it can never observe the bucket keying it names. A
    // negation changes the child's surviving bucket while the memo stays warm, which is the real test.
    const textDelta = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "hello"),
    );
    await gw.append([signClaims(makeNegationClaims(OP, 99, textDelta!.id), SEED)]);

    // POSITIVE: the resolver re-ran over the surviving (now empty) bucket and joined nothing. A
    // negative assertion would also be satisfied by the field vanishing, which proves nothing.
    expect(post0(await gw.query(FEED_Q)).text).toBe("");
    await gw.close();
  });

  it("a resolver the PARENT lens declares on an expanding field wins over the child decoration", async () => {
    // Precedence: decorate children first, then let this lens's own resolvers have the last word on
    // its own fields. With the order inverted, the decoration overwrites the parent's declared
    // resolver and the field silently serves child views the lens never asked for.
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
      ATTRIBUTION,
    );
    await gw.publishRegistration(
      FEED_H,
      FEED_S,
      ["feed:main"],
      undefined,
      undefined,
      undefined,
      ["post"],
      {
        post: {
          code: "export default (bucket) => bucket.map(() => 'the lens decided');",
          rung: "a" as const,
          type: "list" as const,
        },
      },
    );
    const feed = await gw.query(FEED_Q);
    expect((feed.data as { feed: { post: unknown } }).feed.post).toEqual(["the lens decided"]);
    await gw.close();
  });

  it("a child embedded BESIDE other pointers is decorated too (a multi-pointer entry)", async () => {
    // candidateValue renders an entry with several non-filing pointers as an object keyed by role, in
    // BOTH the full and the stripped resolve — so the splice must recurse key-by-key to reach the
    // child. Otherwise the same post reads attributed on its own and raw inside the feed.
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
    const richLink = signClaims(
      {
        timestamp: 10,
        author: OP,
        pointers: [
          {
            role: "feed",
            target: { kind: "entity", entity: { id: "feed:main", context: "post" } },
          },
          { role: "post", target: { kind: "entity", entity: { id: "post:a1", context: "in" } } },
          { role: "pinnedAt", target: { kind: "primitive", value: 1700 } },
        ],
      },
      SEED,
    );
    await gw.append([richLink, say("post:a1", "hello", 20)]);
    await gw.publishRegistration(
      POST_H,
      POST_S,
      ["post:a1"],
      undefined,
      undefined,
      undefined,
      ["text"],
      ATTRIBUTION,
    );
    await gw.publishRegistration(FEED_H, FEED_S, ["feed:main"]);
    const feed = await gw.query(FEED_Q);
    const entry = (feed.data as { feed: { post: { post: { text: string }; pinnedAt: number }[] } })
      .feed.post[0]!;
    expect(entry.pinnedAt).toBe(1700); // the sibling pointer rode along untouched
    expect(entry.post.text).toBe(`${SIG6}: hello`); // ...and the child inside it IS attributed
    await gw.close();
  });
});
