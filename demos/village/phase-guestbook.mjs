// Phase GUESTBOOK — A FACE THAT WRITES (SPEC §23.3). §23 v1 renderers only READ; this act closes the
// loop: a rendered route can WRITE. The almanac mounts a guestbook whose renderer paints an HTML <form>,
// a visitor POSTs a message over plain HTTP, and the STORE signs the resulting delta as a per-renderer
// PEN — a granted-author identity provisioned in config, never the visitor's key. Provenance shows the
// mediating code; revocation strikes the pen's grant. The two keys of §6: provisioning the pen's seed is
// custody, the GRANT is authorization — revoke the grant and the same form writes nothing, while every
// entry it already wrote stays on the record, still attributed to the pen.

import { authorForSeed, signClaims, makeNegationClaims, parseSchema, parseTerm } from "@bombadil/rhizomatic";
import { grantClaims, STORE_ENTITY, publicClaims } from "../../dist/index.js";
import { check, openStore, opToken, summary } from "./harness.mjs";

const PEN_SEED = "9e".repeat(32);
const PEN = authorForSeed(PEN_SEED);

const GATHER = {
  op: "group",
  key: "byTargetContext",
  in: {
    op: "select",
    pred: { hasPointer: { targetEntity: { var: "root" } } },
    in: { op: "mask", policy: "drop", in: "input" },
  },
};
const PICK = { pick: { order: { byTimestamp: "desc" } } };
const BOOK = { name: "Guestbook", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({ props: { message: PICK }, default: PICK });

// A renderer that PAINTS A FORM. It reads the latest message and posts a new one back to its own route.
const FORM =
  "export default (n) => `<main><p class=\"latest\">latest: ${n.view.message ?? \"(empty)\"}</p>" +
  "<form method=\"POST\" action=\"/almanac/app/guestbook/${encodeURIComponent(n.entity)}\">" +
  "<input name=\"message\"><button>sign</button></form></main>`;";

let almanac;
try {
  // Provision the guest-pen's SEED into the store's config (custody), then GRANT it write standing.
  almanac = await openStore("almanac", { pens: { "guest-pen": PEN_SEED } });
  const operator = almanac.operator;
  const subject = "guestbook:townhall";
  const post = (message, door) =>
    fetch(`${almanac.base}/app/guestbook/${encodeURIComponent(subject)}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(door === "op" ? { authorization: `Bearer ${opToken("almanac")}` } : {}),
      },
      body: new URLSearchParams({ message }).toString(),
    });

  // Clear the stage; register the lens (message writable); grant the pen; declare public; push the form.
  for (const stale of almanac.gateway.renderers().filter((r) => r.route === "guestbook")) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "guestbook clears its stage"), almanac.seed),
    ]);
  }
  await almanac.gateway.publishRegistration(BOOK, SCHEMA, [subject], undefined, undefined, undefined, ["message"]);
  const grant = signClaims(grantClaims(STORE_ENTITY, PEN, "write", operator, Date.now()), almanac.seed);
  await almanac.gateway.append([grant]);
  await almanac.gateway.append([signClaims(publicClaims(["Guestbook"], operator, Date.now()), almanac.seed)]);
  await almanac.gateway.publishRenderer({
    route: "guestbook",
    schema: "Guestbook",
    consumes: ["message"],
    bundle: FORM,
    writable: ["message"],
    pen: "guest-pen",
  });

  // GUESTBOOK.1 — an ANONYMOUS visitor POSTs the form; the store signs it as the PEN, and the re-rendered
  // page shows the new entry. No token, no key of the visitor's own — the mediating pen wrote it.
  const res = await post("the bridge is beautiful at dusk");
  const html = await res.text();
  const landed = [...almanac.gateway.reactor.snapshot()].find(
    (d) => d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "the bridge is beautiful at dusk"),
  );
  check(
    "guestbook.1",
    "an anonymous form POST is signed BY THE PEN (not the visitor) and the route re-renders with the new entry (§23.3)",
    res.status === 200 && html.includes("the bridge is beautiful at dusk") && landed?.claims.author === PEN,
    `${res.status} — author ${landed?.claims.author === PEN ? "= pen ✓" : "≠ pen ✗"}`,
  );

  // GUESTBOOK.2 — REVOKE the pen's grant. The very same form now writes NOTHING (provisioning ≠ authority),
  // but the earlier entry stays on the record, still attributed to the pen.
  await almanac.gateway.append([
    signClaims(makeNegationClaims(operator, Date.now(), grant.id, "the operator revokes the guest-pen"), almanac.seed),
  ]);
  const after = await post("a message that must not land");
  const sneaked = [...almanac.gateway.reactor.snapshot()].find(
    (d) => d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "a message that must not land"),
  );
  const stillThere = [...almanac.gateway.reactor.snapshot()].find(
    (d) => d.claims.pointers.some((p) => p.target.kind === "primitive" && p.target.value === "the bridge is beautiful at dusk"),
  );
  check(
    "guestbook.2",
    "revoke the pen's grant and the form writes nothing (provisioning is not authorization, §6); past entries stay attributed",
    after.status === 403 && sneaked === undefined && stillThere?.claims.author === PEN,
    `after revoke: ${after.status}, sneaked ${sneaked === undefined ? "blocked ✓" : "LANDED ✗"}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase guestbook — a face that writes (§23.3)");
