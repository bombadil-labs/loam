// The board's vocabulary (§34), in the one registration dialect every door speaks — the same
// object `loam register <file>`, POST /:mount/register, and the MCP tool accept. Two lenses:
//
//   BoardItem — one entity per item (`board:pr-262`), seven latest-wins props, and the
//               `boardEvent` claim template: one call, ONE signed delta, a status transition.
//   Board     — the singleton `board:main`. Its gather expands the `item` role of every
//               membership claim through the BoardItem reading, so the whole board arrives at a
//               renderer as one resolved View: `{ banner, items: [<BoardItem view>...] }`. The
//               `boardAdd` template files an item in one call.
//
// Membership is explicit because Loam has no list-things-of-a-kind door yet — nothing can
// enumerate "all BoardItems" (T110 owns that gap). Nothing is ever removed to leave the board:
// `status: shipped` IS the exit, and the view filters.

/** The singleton the board renders from. */
export const BOARD_ENTITY = "board:main";

/** The route the renderer claims: `/:mount/app/board/board:main`. */
export const BOARD_ROUTE = "board";

/** The banner a fresh board wakes up with (the operator can re-claim it any time). */
export const BANNER_DEFAULT = "Loam — the board · a Loam app, eating its own dogfood";

const PICK = { pick: { order: { byTimestamp: "desc" } } };

export const BOARD_ITEM_REGISTRATION = {
  hyperschema: {
    name: "BoardItem",
    alg: 1,
    body: {
      op: "group",
      key: "byTargetContext",
      in: {
        op: "select",
        pred: { hasPointer: { targetEntity: { var: "root" } } },
        in: { op: "mask", policy: "drop", in: "input" },
      },
    },
  },
  schema: {
    // `brief` is the expandable long form: the open questions and the recommendation, in STE.
    // Blank-line breaks are paragraph breaks; the renderer owns that reading.
    props: { kind: PICK, title: PICK, seam: PICK, url: PICK, status: PICK, est: PICK, brief: PICK },
    default: PICK,
  },
  roots: [],
  writable: ["kind", "title", "seam", "url", "status", "est", "brief"],
  mutations: {
    // A transition in one authed call: subject at (item, status), one primitive value.
    boardEvent: {
      pointers: [
        { role: "subject", at: { arg: "item" }, context: "status" },
        { role: "value", value: { arg: "status" } },
      ],
    },
  },
};

export const BOARD_REGISTRATION = {
  hyperschema: {
    name: "Board",
    alg: 1,
    body: {
      op: "expand",
      role: { exact: "item" },
      schema: "BoardItem",
      reading: "BoardItem",
      in: {
        op: "group",
        key: "byTargetContext",
        in: {
          op: "select",
          pred: { hasPointer: { targetEntity: { var: "root" } } },
          in: { op: "mask", policy: "drop", in: "input" },
        },
      },
    },
  },
  schema: {
    props: {
      banner: PICK,
      // Every filing survives, oldest first — the render order, and the reason a duplicate
      // boardAdd is harmless noise rather than a lost item. The dual is honest about the cost:
      // because `all` collects EVERY membership delta (each boardAdd is a distinct delta, H4),
      // genuinely removing an item means striking every membership delta that filed it — a
      // single strike leaves a twice-added item listed through its other filing. v1 has no
      // retract mutation; the operator strikes memberships directly (see the H1 rail in
      // test/board/board-render.test.ts) until T110's listing door owns removal.
      items: { all: { order: { byTimestamp: "asc" } } },
    },
    default: PICK,
  },
  roots: [BOARD_ENTITY],
  writable: ["banner"],
  mutations: {
    // One call files an item on the board: subject at (board, items), the expanded `item` edge.
    boardAdd: {
      pointers: [
        { role: "subject", at: { arg: "board" }, context: "items" },
        { role: "item", at: { arg: "item" }, context: "listed" },
      ],
    },
  },
};
