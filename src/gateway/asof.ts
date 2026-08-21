// THE TIME FRAME (SPEC §26) — the chrome a serving path wraps around a rendered route's output
// when the door resolved a MOMENT rather than the present.
//
// §26 put the time pin on the data doors, where a caller reads `_asOf` and `_forgotten` beside the
// view and decides what to do with them. A rendered route has no such caller. The reader is a
// person looking at a page, and the only code between the door and their eyes is an UNTRUSTED
// bundle written before the pin existed — it would simply not draw one. So a payload member would
// satisfy nothing here: an unmodified renderer ignores it, and the page then shows the past while
// looking exactly like the present. The statement must be in the SERVED BYTES, put there by the
// door. That is what this is, and it is why §24.7's frame is the precedent rather than `_asOf`.
//
// TWO SENTENCES, AND THE SECOND IS THE HARD ONE. The pin is easy: the door knows which moment it
// resolved against, so it says it. The erasure annotation must not overclaim in either direction.
// `forgottenSince` is STORE-WIDE by necessity — a purged delta's entity is unknowable, so the only
// honest signal is temporal. The banner therefore may not say "something on this page was erased",
// because it does not know that; and it may not stay silent either, because §11 outranks §26 and
// the page genuinely may be less complete than the moment was. It says exactly what is known: the
// ground forgot, this many times, at these moments, and nothing records what.
//
// IT IS CHROME, NOT CONFINEMENT — the same limit §24.7's frame carries. Untrusted markup can
// restyle or cover it. What is guaranteed is that the statement is in the bytes, where an operator
// reading source, a screenshot diff, or a rail can find it.

import type { ResolvedNode } from "../surface/surface.js";

// A long erasure history would otherwise paint an unbounded banner from a caller-chosen moment
// (H8's shape, on a page). The COUNT is always exact; the enumeration is capped and says so.
const MAX_LISTED_MOMENTS = 8;

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The banner's own markup: what moment the door served, and — when the window since that moment
 * contains one — the erasure confession, plus any read-closing slate's suppression count (§29.3).
 * Every value here is a number the gateway computed; nothing a caller typed reaches the page.
 */
export function asOfBanner(node: ResolvedNode): string {
  const forgotten = node.forgotten ?? [];
  const listed = forgotten.slice(0, MAX_LISTED_MOMENTS).join(", ");
  const rest = forgotten.length - Math.min(forgotten.length, MAX_LISTED_MOMENTS);
  const confession =
    forgotten.length === 0
      ? ""
      : `<span data-loam-asof-says="forgotten">Since that moment this store lawfully forgot ` +
        `${plural(forgotten.length, "record", "records")}, at ${escape(listed)}` +
        `${rest > 0 ? ` and ${rest} more` : ""}. An erasure keeps no content and names no ` +
        `entity, so this page cannot tell you whether it took anything you see here.</span> `;
  const slate =
    node.suppressed === undefined || node.suppressed <= 0
      ? ""
      : `<span data-loam-asof-says="suppressed">A standing slate withheld ` +
        `${plural(node.suppressed, "delta", "deltas")} from the ground behind this page.</span>`;
  return (
    `<aside data-loam-asof="1" role="note" ` +
    `style="border:3px solid #4c6b8a;background:#eef4fb;color:#1c1917;padding:.75rem;` +
    `font:14px/1.45 system-ui,sans-serif">` +
    `<strong>As it stood.</strong> ` +
    `<span data-loam-asof-says="pin">This is a reading of the past. The door resolved this page ` +
    `against the ground as of ${escape(String(node.asOf))} (milliseconds since 1970), not against ` +
    `the present.</span> ` +
    confession +
    slate +
    `</aside>`
  );
}

// Where the banner goes in a renderer's own HTML — the same placement rule §24.7's frame follows,
// because a v1 bundle may return a fragment or a whole document and the statement must be visible
// without scrolling either way.
const BODY_OPEN = /<body\b[^>]*>/i;

/**
 * Wrap an as-of render's HTML in the time frame (SPEC §26). A present-tense node is returned
 * untouched, so a page that named no moment is byte-identical to what it always was.
 */
export function frameAsOf(html: string, node: ResolvedNode): string {
  if (node.asOf === undefined) return html;
  const banner = asOfBanner(node);
  const at = BODY_OPEN.exec(html);
  if (at !== null) {
    const cut = at.index + at[0].length;
    return html.slice(0, cut) + banner + html.slice(cut);
  }
  return `${banner}<div data-loam-asof-stage="1">${html}</div>`;
}
