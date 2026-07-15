// Phase BYTES — A FACE MADE OF BYTES (SPEC §23.7). Renderers paint pixels; some of those pixels ARE
// bytes — an avatar, a font, a sound. A schema that gathers a `bytes` Target resolves that field to raw
// bytes, and Loam hands every view consumer the same self-describing envelope { mime, ref, base64url? }.
// This act pushes a Portrait lens with an avatar image fact, pushes a renderer that paints an <img>
// whose src points at the BYTE-DOOR, GETs the route, and then follows that <img src> over plain HTTP to
// fetch the raw image back — proof of read: the door re-resolves the lens and serves the bytes only
// because the view actually contains them. Then the §11 beat: erase the avatar and the door goes dark.

import { parseSchema, parseTerm, signClaims, makeNegationClaims } from "@bombadil/rhizomatic";
import { publicClaims } from "../../dist/index.js";
import { check, openStore, opToken, summary } from "./harness.mjs";

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
const PORTRAIT = { name: "Portrait", alg: 1, body: parseTerm(GATHER) };
const SCHEMA = parseSchema({ props: { name: PICK, avatar: PICK }, default: PICK });

// A 1×1 PNG-ish stub — real bytes, an honest image/png mime. Small enough to inline (base64url present),
// but the renderer points at the byte-door by `ref` regardless: the ref is the stable, cache-forever id.
const AVATAR = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

// The renderer paints an <img> whose src is the byte-door for the avatar's ref (§23.7). It reads the
// envelope the host handed it — `n.view.avatar.ref` — and knows nothing of Uint8Arrays or hashing.
const PORTRAIT_CARD =
  "export default (n) => `<figure class=\"portrait\"><img alt=\"${n.view.name}\" src=\"/almanac/bytes/${n.view.avatar.ref}?from=Portrait/${encodeURIComponent(n.entity)}\"><figcaption>${n.view.name}</figcaption></figure>`;";

let almanac;
try {
  almanac = await openStore("almanac");
  const operator = almanac.operator;
  const subject = "portrait:wren";

  // Clear the stage: strike every surviving Portrait renderer and registration (the home persists).
  for (const stale of almanac.gateway.renderers().filter((r) => r.route === "portrait")) {
    await almanac.gateway.append([
      signClaims(makeNegationClaims(operator, Date.now(), stale.deltaId, "phase bytes clears its stage"), almanac.seed),
    ]);
  }

  await almanac.gateway.publishRegistration(PORTRAIT, SCHEMA, [subject], undefined, undefined, undefined, ["name"]);
  const fact = (ctx, target) =>
    signClaims(
      {
        timestamp: Date.now(),
        author: operator,
        pointers: [
          { role: "subject", target: { kind: "entity", entity: { id: subject, context: ctx } } },
          { role: "value", target },
        ],
      },
      almanac.seed,
    );
  const avatarDelta = fact("avatar", { kind: "bytes", mime: "image/png", value: AVATAR });
  await almanac.gateway.append([fact("name", { kind: "primitive", value: "Wren" }), avatarDelta]);
  await almanac.gateway.append([signClaims(publicClaims(["Portrait"], operator, Date.now()), almanac.seed)]);
  await almanac.gateway.publishRenderer({
    route: "portrait",
    schema: "Portrait",
    consumes: ["name", "avatar"],
    bundle: PORTRAIT_CARD,
  });

  // BYTES.1 — GET the route; the rendered HTML carries an <img src> pointing at the byte-door.
  const page = await fetch(`${almanac.base}/app/portrait/${encodeURIComponent(subject)}`, {
    headers: { authorization: `Bearer ${opToken("almanac")}` },
  });
  const html = await page.text();
  const src = /src="([^"]*\/bytes\/[^"]+)"/.exec(html)?.[1];
  check(
    "bytes.1",
    "a renderer paints an <img> whose src is the byte-door for the avatar's ref (§23.7 envelope reaches the renderer)",
    page.status === 200 && src !== undefined && src.includes("/bytes/") && src.includes("from=Portrait/"),
    src ?? html.slice(0, 60),
  );

  // BYTES.2 — follow that <img src> over HTTP: the door serves the raw image bytes back, mime intact.
  const imgRes = await fetch(`${almanac.base.replace(/\/almanac$/, "")}${src}`);
  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
  check(
    "bytes.2",
    "follow the <img src> to the byte-door — the raw image bytes come back with image/png (proof of read)",
    imgRes.status === 200 &&
      (imgRes.headers.get("content-type") ?? "") === "image/png" &&
      imgBytes.length === AVATAR.length &&
      imgBytes.every((b, i) => b === AVATAR[i]),
    `${imgRes.status} — ${imgBytes.length}B ${imgRes.headers.get("content-type")}`,
  );

  // BYTES.3 — §11 reaches the byte-door: erase the avatar fact and the ref goes dark, by construction
  // (the live re-resolved view no longer contains it — the door never cached the bytes).
  await almanac.gateway.erase(avatarDelta.id, { reason: "the portrait's subject asked to be forgotten" });
  const afterErase = await fetch(`${almanac.base.replace(/\/almanac$/, "")}${src}`);
  check(
    "bytes.3",
    "erase the avatar and the byte-door 404s — §11 falls out for free (no cached bytes outlive the ground)",
    afterErase.status === 404,
    `after erase: ${afterErase.status}`,
  );
} finally {
  await almanac?.close().catch(() => {});
}
summary("phase bytes — a face made of bytes (§23.7)");
