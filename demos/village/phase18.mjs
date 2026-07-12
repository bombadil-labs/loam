// Phase 18 — THE TAKE-HOME COMPLETES (SPEC §15 continuity, PR #53). Phase 17's wanderer kept
// a whole store in a tab; tonight she takes it home. The tab freezes itself with exportOffer
// (the exact bytes /federate would serve), `loam pull` lands the file in a laptop home that
// holds HER seed — and because genesis is pure, the laptop store IS the tab store: the same
// operator marker by content address, the law binding on arrival, the view matching hash for
// hash. A store born in a browser, served from a laptop; nothing re-signed, nothing lost.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { run } from "../../dist/index.js";
import { check, join, ROOT, signClaims, sleep, summary } from "./harness.mjs";

const tab = await import(pathToFileURL(join(ROOT, "..", "..", "dist", "browser", "index.js")).href);

function origin() {
  const map = new Map();
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

const NOTE_BODY = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };

const out = [];
const io = { out: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`) };
const laptop = mkdtempSync(join(tmpdir(), "wanderer-laptop-"));

let notebook;
let served;
try {
  // ---- the tab, as phase 17 left it: governed, registered, lived-in
  const seed = tab.mintSeed();
  const wanderer = tab.authorForSeed(seed);
  notebook = await tab.Gateway.boot(
    new tab.LocalStorageBackend("notebook", origin()),
    tab.assembleGenesis({
      operatorSeed: seed,
      registrations: [
        {
          schema: { name: "Note", alg: 1, body: tab.parseTerm(NOTE_BODY) },
          policy: tab.parseSchema({ props: { text: PICK }, default: PICK }),
          roots: ["note:first"],
        },
      ],
    }),
  );
  await notebook.append([
    signClaims(
      {
        timestamp: 1000,
        author: wanderer,
        pointers: [
          {
            role: "subject",
            target: { kind: "entity", entity: { id: "note:first", context: "text" } },
          },
          {
            role: "value",
            target: { kind: "primitive", value: "the village waved back; taking notes home" },
          },
        ],
      },
      seed,
    ),
  ]);
  const inTab = await notebook.query(`{ note(entity: "note:first") { text _hex } }`);
  const tabHex = inTab.data?.note?._hex;

  // ---- 18.1: the export is a frozen federation offer, and it is honest about its shape
  const offer = tab.exportOffer(notebook);
  const parsed = JSON.parse(offer);
  const file = join(laptop, "notebook-export.json");
  writeFileSync(file, offer);
  await notebook.close();
  check(
    "18.1",
    "the tab freezes itself: exportOffer is a /federate body, deltas with ids and signatures",
    Array.isArray(parsed.deltas) && parsed.deltas.length > 0 && parsed.deltas.every((d) => d.id),
    `${parsed.deltas.length} deltas in the file`,
  );

  // ---- 18.2: `loam init --seed` + `loam pull` — the laptop store IS the tab store
  await run(["init", "--home", laptop, "--seed", seed], io);
  const code = await run(["pull", file, "--home", laptop], io);
  check(
    "18.2",
    "one command lands the frozen offer in her laptop home",
    code === 0 && /[1-9]\d* accepted/.test(out.join("\n")),
    out.find((l) => l.includes("accepted")) ?? "",
  );

  // ---- 18.3: served from the laptop, the view matches HASH FOR HASH — the same store
  served = await run(["serve", "--http", "--home", laptop, "--token", "tok"], io, {
    detach: true,
  });
  if (typeof served === "number") throw new Error("serve should return a handle");
  const res = await fetch(`${served.url}/default/graphql`, {
    method: "POST",
    headers: { authorization: "Bearer tok", "content-type": "application/json" },
    body: JSON.stringify({ query: `{ note(entity: "note:first") { text _hex } }` }),
  });
  const answer = await res.json();
  check(
    "18.3",
    "served from the laptop, the notebook answers through the IMPORTED law — _hex for _hex",
    answer.data?.note?.text === "the village waved back; taking notes home" &&
      typeof tabHex === "string" &&
      answer.data?.note?._hex === tabHex,
    `tab ${String(tabHex).slice(0, 12)}… = laptop ${String(answer.data?.note?._hex).slice(0, 12)}…`,
  );

  // ---- 18.4: pulling the same file again accepts nothing — union is union
  out.length = 0;
  await served.close();
  served = undefined;
  await run(["pull", file, "--home", laptop], io);
  check(
    "18.4",
    "pulling the same offer again accepts nothing new — double delivery is harmless",
    /\b0 accepted/.test(out.join("\n")),
    out.find((l) => l.includes("accepted")) ?? "",
  );
} finally {
  await served?.close().catch(() => {});
  await sleep(200);
  rmSync(laptop, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
summary("phase 18 — the take-home");
