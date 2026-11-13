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

const POST_H = { name: "PostH", alg: 1, body: parseTerm(GATHER) };
const POST_S = { name: "Post", alg: 1, props: new Map([["text", PICK]]), default: PICK };
const ATTRIBUTION = {
  text: {
    code: "export default (bucket) => bucket.map((e) => `${String(e.author).slice(-6)}: ${e.value}`).join(' | ');",
    rung: "a" as const,
    type: "string" as const,
  },
};

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
      validFrom: 10,
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
      validFrom: at,
      author: OP,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: post, context: "text" } } },
        { role: "text", target: { kind: "primitive", value: text } },
      ],
    },
    SEED,
  );

const AUTHOR_H = { name: "AuthorH", alg: 1, body: parseTerm(GATHER) };
const AUTHOR_S = { name: "Author", alg: 1, props: new Map([["handle", PICK]]), default: PICK };
const HANDLE = {
  handle: {
    code: "export default (bucket) => bucket.map((e) => `@${e.value}`).join('');",
    rung: "a" as const,
    type: "string" as const,
  },
};
const POST_WITH_AUTHOR_H = {
  name: "PostH",
  alg: 1,
  body: parseTerm({
    op: "expand",
    role: { exact: "author" },
    schema: "AuthorH",
    reading: "Author",
    in: GATHER,
  }),
};
const POST_WITH_AUTHOR_S = {
  name: "Post",
  alg: 1,
  props: new Map([
    ["text", PICK],
    ["author", PICK],
  ]),
  default: PICK,
};

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

    expect(directText).toBe(`${SIG6}: hello`);
    expect(post0(feed).text).toBe(directText);
    await gw.close();
  });

  it("a child reading with no resolvers passes through untouched (raw text)", async () => {
    const gw = await feedGateway(false);
    const feed = await gw.query(FEED_Q);
    expect(post0(feed).text).toBe("hello");
    await gw.close();
  });

  it("the child resolver RE-RUNS when the child's own bucket changes (a retraction, not a reseat)", async () => {
    const gw = await feedGateway(true);
    expect(post0(await gw.query(FEED_Q)).text).toBe(`${SIG6}: hello`);

    const textDelta = [...gw.reactor.snapshot()].find((d) =>
      d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "hello"),
    );
    await gw.append([signClaims(makeNegationClaims(OP, 99, textDelta!.id), SEED)]);

    expect(post0(await gw.query(FEED_Q)).text).toBe("");
    await gw.close();
  });

  it("a resolver the PARENT lens declares on an expanding field wins over the child decoration", async () => {
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
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
    const richLink = signClaims(
      {
        timestamp: 10,
        validFrom: 10,
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
    expect(entry.pinnedAt).toBe(1700);
    expect(entry.post.text).toBe(`${SIG6}: hello`);
    await gw.close();
  });

  it("the PINNED version door decorates children exactly as the live query does", async () => {
    const gw = await feedGateway(true);
    const live = post0(await gw.query(FEED_Q)).text;

    const feedVersion = gw.registrationVersions().find((v) => v.hyperschema.name === "FeedH");
    const pinned = gw.resolvePinned(feedVersion!, "feed:main");
    const pinnedPost = (pinned.view as { post: Record<string, unknown>[] }).post[0]!;
    expect(pinnedPost.text).toBe(live);
    expect(pinnedPost.text).toBe(`${SIG6}: hello`);
    await gw.close();
  });

  it("the live WATCH stream decorates children too — a frame reads as a query does", async () => {
    const gw = await feedGateway(true);
    const events = await gw.subscribe(`subscription { feed(entity: "feed:main") { post } }`);
    const first = (await events.next()).value as { feed: { post: Record<string, unknown>[] } };
    expect(first.feed.post[0]!.text).toBe(`${SIG6}: hello`);
    await events.return?.(undefined);
    await gw.close();
  });

  it("decoration RECURSES: a feed's post's author is decorated through the author's own reading", async () => {
    const gw = await Gateway.open(new MemoryBackend(), { seed: SEED });
    await gw.append([signClaims(operatorMarkerClaims(OP), SEED)]);
    await gw.append([
      signClaims(
        {
          timestamp: 5,
          validFrom: 5,
          author: OP,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "person:ann", context: "handle" } },
            },
            { role: "handle", target: { kind: "primitive", value: "ann" } },
          ],
        },
        SEED,
      ),
      signClaims(
        {
          timestamp: 6,
          validFrom: 6,
          author: OP,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: "post:a1", context: "author" } },
            },
            {
              role: "author",
              target: { kind: "entity", entity: { id: "person:ann", context: "by" } },
            },
          ],
        },
        SEED,
      ),
      link("post:a1"),
      say("post:a1", "hello", 20),
    ]);
    await gw.publishRegistration(
      AUTHOR_H,
      AUTHOR_S,
      [],
      undefined,
      undefined,
      undefined,
      ["handle"],
      HANDLE,
    );
    await gw.publishRegistration(
      POST_WITH_AUTHOR_H,
      POST_WITH_AUTHOR_S,
      ["post:a1"],
      undefined,
      undefined,
      undefined,
      ["text"],
      ATTRIBUTION,
    );
    await gw.publishRegistration(FEED_H, FEED_S, ["feed:main"]);

    const feed = await gw.query(FEED_Q);
    const post = post0(feed) as { text: string; author: { handle: string } };
    expect(post.text).toBe(`${SIG6}: hello`);
    expect(post.author.handle).toBe("@ann");
    await gw.close();
  });
});
