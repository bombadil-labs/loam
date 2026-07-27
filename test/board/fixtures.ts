// The board suite's shared world (§34): a governed store served over HTTP, the board vocabulary
// registered through the /register door, and three tokens — the operator, a granted author
// (fable), and an ungranted stranger. Every store here is a MemoryBackend or a test-owned temp
// dir; the live board home is never touched (the standing erasure rule).

import { authorForSeed, signClaims, type Delta } from "@bombadil/rhizomatic";
import { grantClaims } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import {
  BOARD_ENTITY,
  BOARD_ITEM_REGISTRATION,
  BOARD_REGISTRATION,
} from "../../demos/board/vocabulary.mjs";

export const OP_SEED = "0b".repeat(32);
export const FABLE_SEED = "fa".repeat(32);
export const STRANGER_SEED = "5d".repeat(32);
export const OPERATOR = authorForSeed(OP_SEED);
export const FABLE = authorForSeed(FABLE_SEED);
export const STRANGER = authorForSeed(STRANGER_SEED);

export const MOUNT = "board";

export interface BoardWorld {
  readonly gw: Gateway;
  readonly handle: ServerHandle;
  readonly base: string;
}

// A fresh governed store: the operator's genesis, fable granted write standing, three tokens at
// the door. The vocabulary is NOT registered here — (a)'s rail owns that door and the others call
// registerVocabulary explicitly, so no rail passes on a fixture's say-so.
export async function bootWorld(): Promise<BoardWorld> {
  const gw = await Gateway.boot(new MemoryBackend(), assembleGenesis({ operatorSeed: OP_SEED }));
  await gw.append([signClaims(grantClaims(STORE_ENTITY, FABLE, "write", OPERATOR, 1), OP_SEED)]);
  const handle = await serve({
    mounts: { [MOUNT]: gw },
    tokens: {
      op: { operator: true },
      fable: { actor: FABLE_SEED },
      stranger: { actor: STRANGER_SEED },
    },
    port: 0,
    host: "127.0.0.1",
  });
  return { gw, handle, base: handle.url };
}

// Register the vocabulary through the door — BoardItem first: Board's gather expands its members
// through the BoardItem reading, so the reading must be bound before Board publishes.
export async function registerVocabulary(base: string): Promise<Response[]> {
  const out: Response[] = [];
  for (const body of [BOARD_ITEM_REGISTRATION, BOARD_REGISTRATION]) {
    out.push(
      await fetch(`${base}/${MOUNT}/register`, {
        method: "POST",
        headers: { authorization: "Bearer op", "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  return out;
}

export interface GqlResult {
  readonly status: number;
  readonly json: {
    readonly data?: Record<string, unknown>;
    readonly errors?: readonly unknown[];
  };
}

export async function gql(base: string, query: string, token?: string): Promise<GqlResult> {
  const res = await fetch(`${base}/${MOUNT}/graphql`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ query }),
  });
  return { status: res.status, json: (await res.json()) as GqlResult["json"] };
}

export interface ItemProps {
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  readonly seam?: string;
  readonly url?: string;
  readonly est?: number;
  readonly brief?: string;
}

// One item, born through the door: a boardAdd membership claim, then the typed field mutation
// for its props — the same two calls a session makes.
export async function addItem(
  base: string,
  token: string,
  item: string,
  props: ItemProps,
): Promise<void> {
  const add = await gql(
    base,
    `mutation { boardAdd(board: ${JSON.stringify(BOARD_ENTITY)}, item: ${JSON.stringify(item)}) { delta } }`,
    token,
  );
  if (add.json.errors !== undefined) throw new Error(JSON.stringify(add.json.errors));
  const args = Object.entries(props)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(", ");
  const set = await gql(
    base,
    `mutation { boardItem(entity: ${JSON.stringify(item)}, ${args}) { status } }`,
    token,
  );
  if (set.json.errors !== undefined) throw new Error(JSON.stringify(set.json.errors));
}

// One transition: the boardEvent claim — one call, one signed delta.
export async function boardEvent(
  base: string,
  token: string | undefined,
  item: string,
  status: string,
): Promise<GqlResult> {
  return gql(
    base,
    `mutation { boardEvent(item: ${JSON.stringify(item)}, status: ${JSON.stringify(status)}) { delta } }`,
    token,
  );
}

// The deltas that carry an item's status history — the ground under latest-wins.
export function statusDeltas(gw: Gateway, item: string): Delta[] {
  return [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (p) =>
        p.target.kind === "entity" &&
        p.target.entity.id === item &&
        p.target.entity.context === "status",
    ),
  );
}
