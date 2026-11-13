#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  authorForSeed,
  schemaCanonicalHex,
  signClaims,
  termCanonicalHex,
} from "@bombadil/rhizomatic";
import {
  Gateway,
  SqliteBackend,
  STORE_ENTITY,
  assembleGenesis,
  grantClaims,
  initHome,
  parseRegistrationInput,
  publicClaims,
  storePath,
} from "../../dist/index.js";
import {
  BANNER_DEFAULT,
  BOARD_ENTITY,
  BOARD_ITEM_REGISTRATION,
  BOARD_REGISTRATION,
  BOARD_ROUTE,
} from "./vocabulary.mjs";

const GRANT_TS = 1;
const PUBLIC_TS = 2;

const flags = new Map();
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith("--") || argv[i + 1] === undefined) {
    process.stderr.write(`boot: unusable argument ${argv[i]}\n`);
    process.exit(2);
  }
  flags.set(argv[i].slice(2), argv[i + 1]);
}
if (!flags.has("home")) {
  process.stderr.write("boot: whose board? --home <dir> names the store's home\n");
  process.exit(2);
}
const home = resolve(flags.get("home"));
const port = flags.get("port") ?? "5701";

const init = initHome(home);
const seed = readFileSync(join(home, "operator.seed"), "utf8").trim();
const operator = authorForSeed(seed);
const fableSeedPath = join(home, "fable.seed");
if (!existsSync(fableSeedPath)) {
  writeFileSync(fableSeedPath, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600 });
}
const fableSeed = readFileSync(fableSeedPath, "utf8").trim();
const fable = authorForSeed(fableSeed);
const tokenPath = join(home, "door.token");
if (!existsSync(tokenPath)) {
  writeFileSync(tokenPath, `${randomBytes(24).toString("hex")}\n`, { mode: 0o600 });
}

const gw = await Gateway.boot(
  new SqliteBackend(storePath(home)),
  assembleGenesis({ operatorSeed: seed }),
);
const say = (line) => process.stdout.write(`${line}\n`);
say(`the board — ${home}`);
say(`  operator  ${operator}${init.created ? "  (minted)" : ""}`);
say(`  fable     ${fable}  (seed: fable.seed — hand it to sessions)`);

const lawPrint = (r) =>
  [
    termCanonicalHex(r.hyperschema.body),
    schemaCanonicalHex({ props: r.schema.props, default: r.schema.default }),
    JSON.stringify([...r.roots].sort()),
    JSON.stringify([...(r.writable ?? [])].sort()),
    JSON.stringify(Object.fromEntries(Object.entries(r.mutations ?? {}).sort())),
  ].join("|");

try {
  for (const raw of [BOARD_ITEM_REGISTRATION, BOARD_REGISTRATION]) {
    const input = parseRegistrationInput(raw);
    const held = gw.registered.find((r) => r.hyperschema.name === input.hyperschema.name);
    if (held !== undefined && lawPrint(held) === lawPrint(input)) {
      say(`  law       ${input.hyperschema.name} already bound — kept`);
      continue;
    }
    await gw.publishRegistration(
      input.hyperschema,
      input.schema,
      input.roots,
      undefined,
      input.entity,
      input.mutations,
      input.writable,
      input.resolvers,
    );
    say(
      `  law       ${input.hyperschema.name} ${held === undefined ? "registered" : "re-expressed — the blessed form supersedes what was bound"}`,
    );
  }

  await gw.append([
    signClaims(grantClaims(STORE_ENTITY, fable, "write", operator, GRANT_TS), seed),
    signClaims(publicClaims(["Board"], operator, PUBLIC_TS), seed),
  ]);
  say(`  law       fable holds write standing · Board is public (tokenless reads)`);

  const bundle = readFileSync(new URL("./renderer.mjs", import.meta.url), "utf8");
  await gw.publishRenderer({
    route: BOARD_ROUTE,
    schema: "Board",
    consumes: ["banner", "items"],
    bundle,
  });
  say(`  law       renderer at route "${BOARD_ROUTE}" — this repo's current face`);

  const view = await gw.query(`{ board(entity: ${JSON.stringify(BOARD_ENTITY)}) { banner } }`);
  if ((view.data?.board?.banner ?? null) === null) {
    await gw.append([
      signClaims(
        {
          ...gw.stamp(),
          author: operator,
          pointers: [
            {
              role: "subject",
              target: { kind: "entity", entity: { id: BOARD_ENTITY, context: "banner" } },
            },
            { role: "value", target: { kind: "primitive", value: BANNER_DEFAULT } },
          ],
        },
        seed,
      ),
    ]);
    say(`  banner    "${BANNER_DEFAULT}"`);
  }
} finally {
  await gw.close();
}

const startPath = join(home, "start.sh");
if (!existsSync(startPath)) {
  writeFileSync(
    startPath,
    `#!/bin/sh\n` +
      `# The board, served. Law lives in the store; re-express it with demos/board/boot.mjs.\n` +
      `exec npx loam serve --http --home "${home}" --port ${port} --token "$(cat "${home}/door.token")"\n`,
  );
  chmodSync(startPath, 0o755);
}

say(`  next      sh ${startPath}`);
say(`            board  http://127.0.0.1:${port}/default/app/${BOARD_ROUTE}/${BOARD_ENTITY}`);
say(
  `            mirror node scripts/render-board-artifact.mjs --url http://127.0.0.1:${port}/default --token "$(cat ${tokenPath})"`,
);
