import { authorForSeed, parseSchema, parseTerm, signClaims } from "@bombadil/rhizomatic";
import { Gateway, MemoryBackend, assembleGenesis, publicClaims, serve } from "../dist/index.js";

const SEED = "de".repeat(32);
const PORT = 4500;
const MOUNT = "demo";

const PICK = { pick: { order: { byTimestamp: "desc" } } };
const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PROFILE = { name: "Profile", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({
  props: { name: PICK, bio: PICK, mood: PICK, avatar: PICK },
  default: PICK,
});

const PAGE = `
export default (n) => {
  const v = n.view;
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  return \`<!doctype html><html><head><meta charset="utf-8"><title>\${esc(v.name)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root { color-scheme: light dark; }
    body { margin:0; min-height:100vh; display:grid; place-items:center;
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: radial-gradient(1200px 600px at 20% -10%, #b7d3ff33, transparent),
                  radial-gradient(1000px 500px at 110% 110%, #ffd6a533, transparent), #0f1216; color:#e9edf2; }
    .card { width:min(560px, 92vw); padding:40px; border-radius:20px;
      background:#171b21; box-shadow:0 20px 60px #0008; border:1px solid #ffffff14; }
    .avatar { font-size:64px; line-height:1; }
    h1 { margin:14px 0 2px; font-size:32px; }
    .mood { display:inline-block; margin-top:6px; padding:4px 12px; border-radius:999px;
      background:#7db3ff22; color:#a9cbff; font-size:13px; }
    p.bio { margin:20px 0 0; font-size:17px; line-height:1.6; color:#c4ccd6; }
    footer { margin-top:28px; font-size:12px; color:#6b7684; font-family: ui-monospace, monospace; }
    a { color:#8fb7ff; }
  </style></head>
  <body><main class="card">
    <div class="avatar">\${esc(v.avatar) || "🙂"}</div>
    <h1>\${esc(v.name) || n.entity}</h1>
    <span class="mood">\${esc(v.mood) || "here"}</span>
    <p class="bio">\${esc(v.bio) || "(no bio yet)"}</p>
    <footer>rendered live from Loam · entity \${esc(n.entity)} · _hex \${esc(n.hex).slice(0,16)}…</footer>
  </main></body></html>\`;
};`;

const CARD = `
export default (n) => {
  const v = n.view, esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;" }[c]));
  return \`<span style="font:16px system-ui;padding:10px 14px;border:1px solid #ccc;border-radius:12px;display:inline-block">\${esc(v.avatar)||"🙂"} <b>\${esc(v.name)}</b> — <i>\${esc(v.mood)}</i></span>\`;
};`;

const gw = await Gateway.boot(
  new MemoryBackend(),
  assembleGenesis({
    operatorSeed: SEED,
    registrations: [
      {
        hyperschema: PROFILE,
        schema: SCHEMA,
        roots: [],
        writable: ["name", "bio", "mood", "avatar"],
      },
    ],
  }),
);
const operator = authorForSeed(SEED);

const fact = (entity, ctx, value, ts) =>
  signClaims(
    {
      timestamp: ts,
      validFrom: ts,
      author: operator,
      pointers: [
        { role: "subject", target: { kind: "entity", entity: { id: entity, context: ctx } } },
        { role: "value", target: { kind: "primitive", value } },
      ],
    },
    SEED,
  );
await gw.append([
  fact("profile:ada", "name", "Ada Lovelace", 1),
  fact("profile:ada", "avatar", "🧮", 2),
  fact("profile:ada", "mood", "computing", 3),
  fact(
    "profile:ada",
    "bio",
    "Wrote the first algorithm intended for a machine. Poet of science.",
    4,
  ),
  fact("profile:grace", "name", "Grace Hopper", 1),
  fact("profile:grace", "avatar", "🐛", 2),
  fact("profile:grace", "mood", "debugging", 3),
  fact(
    "profile:grace",
    "bio",
    "Compiler pioneer. Coined 'bug'. Kept a nanosecond in her pocket.",
    4,
  ),
]);

await gw.publishRenderer({
  route: "page",
  schema: "Profile",
  consumes: ["name", "bio", "mood", "avatar"],
  bundle: PAGE,
});
await gw.publishRenderer({
  route: "card",
  schema: "Profile",
  consumes: ["name", "mood", "avatar"],
  bundle: CARD,
});
await gw.append([signClaims(publicClaims(["Profile"], operator, 5), SEED)]);

const handle = await serve({
  mounts: { [MOUNT]: gw },
  tokens: { op: { operator: true } },
  port: PORT,
});
const base = `http://localhost:${PORT}/${MOUNT}/app`;
console.log(`\n  §23 renderers demo — a store serving its own face, live.\n`);
console.log(`  Full page:`);
console.log(`    ${base}/page/profile:ada`);
console.log(`    ${base}/page/profile:grace`);
console.log(`  Compact card (same schema, another face):`);
console.log(`    ${base}/card/profile:ada\n`);
console.log(`  Live edit (then refresh the page):`);
console.log(
  `    curl -s ${`http://localhost:${PORT}/${MOUNT}/graphql`} -H 'authorization: Bearer op' \\`,
);
console.log(`      -H 'content-type: application/json' \\`);
console.log(
  `      -d '{"query":"mutation{ profile(entity:\\"profile:ada\\", mood:\\"inventing\\"){ mood } }"}'\n`,
);
console.log(`  Ctrl-C to stop.\n`);

process.on("SIGINT", async () => {
  await handle.close().catch(() => {});
  await gw.close().catch(() => {});
  process.exit(0);
});
