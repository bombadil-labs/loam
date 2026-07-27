#!/usr/bin/env node
// The board's generated mirror (§34): query the store's own door, render with the SAME renderer
// module the store serves, write the artifact HTML to stdout. Content comes exclusively from the
// store — this script contributes transport and nothing else, so the artifact can never disagree
// with the board it mirrors.
//
//   node scripts/render-board-artifact.mjs --url http://127.0.0.1:5701/default --token "$(cat ~/bombadil-labs/loam-board/door.token)"
//
// Flags: --url <mount base> (or LOAM_BOARD_URL) · --token <bearer> (or LOAM_BOARD_TOKEN; omit for
// a store whose Board lens is public) · --entity <id> (default board:main). The session pipes the
// output into the claude.ai artifact republish — the phone-reachable snapshot, generated.

import render from "../demos/board/renderer.mjs";
import { BOARD_ENTITY } from "../demos/board/vocabulary.mjs";

const flags = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
    process.stderr.write(`render-board-artifact: unusable argument ${argv[i]}\n`);
    process.exit(2);
  }
  flags.set(argv[i].slice(2), argv[i + 1]);
}

const url = flags.get("url") ?? process.env.LOAM_BOARD_URL;
const token = flags.get("token") ?? process.env.LOAM_BOARD_TOKEN;
const entity = flags.get("entity") ?? BOARD_ENTITY;
if (url === undefined) {
  process.stderr.write(
    "render-board-artifact: where is the board? --url http://host:port/<mount> (or LOAM_BOARD_URL)\n",
  );
  process.exit(2);
}

const res = await fetch(`${url}/graphql`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify({
    query: `{ board(entity: ${JSON.stringify(entity)}) { _hex banner items } }`,
  }),
});
if (!res.ok) {
  process.stderr.write(`render-board-artifact: the door answered ${res.status}\n`);
  process.exit(1);
}
const body = await res.json();
if (body.errors !== undefined) {
  process.stderr.write(`render-board-artifact: ${JSON.stringify(body.errors)}\n`);
  process.exit(1);
}

const view = body.data.board;
process.stdout.write(
  render({
    entity,
    view: {
      ...(view.banner === null ? {} : { banner: view.banner }),
      items: view.items ?? [],
    },
    hex: view._hex ?? "",
  }),
);
