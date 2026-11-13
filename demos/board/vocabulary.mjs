export const BOARD_ENTITY = "board:main";

export const BOARD_ROUTE = "board";

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
    props: { kind: PICK, title: PICK, seam: PICK, url: PICK, status: PICK, est: PICK, brief: PICK },
    default: PICK,
  },
  roots: [],
  writable: ["kind", "title", "seam", "url", "status", "est", "brief"],
  mutations: {
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
      items: { all: { order: { byTimestamp: "asc" } } },
    },
    default: PICK,
  },
  roots: [BOARD_ENTITY],
  writable: ["banner"],
  mutations: {
    boardAdd: {
      pointers: [
        { role: "subject", at: { arg: "board" }, context: "items" },
        { role: "item", at: { arg: "item" }, context: "listed" },
      ],
    },
  },
};
