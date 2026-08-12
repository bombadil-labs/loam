// THE SEQUESTERED FRAME (SPEC §24.7) — the chrome a serving path wraps around a quarantined route's
// output, so a person can see that what they are looking at is on probation without reading the spec.
//
// §23 built the path and §24 built the pool: a sandboxed renderer writes under a per-renderer granted
// author into the SANDBOX POOL, never canonical (§23.3), and the pool is the untrusted preset of the
// container primitive (§24.1/§27). What was missing is the part a person can SEE. A quarantined app
// serves from the pool's own gateway, at the container's own mount, over the operator's real ground —
// and nothing on the page said so. The frame says it.
//
// THE COPY IS THE MECHANISM, and it has one forbidden sentence. The frame must never say the app's
// writes go nowhere. They go into the pool, they are LIVE there, and the app reads them back — that is
// the whole point of a dry run. A frame that called the app inert would fool an operator into
// dismissing a face that is genuinely doing things; a frame that said nothing would fool them into
// treating a probationary face as load-bearing. Both are the same failure, and §24.7 names it.
//
// THE COPY MAY NOT OVERCLAIM THE DROP EITHER, and that is the harder half to get right. `drop()`
// REFUSES rather than reporting a discard it cannot prove at the bytes, and it says in its own words
// that a straggler no read ever named is heal's domain — so a banner promising "everything this app
// wrote is gone" would report a completeness nothing verified (H7), from the one surface an operator
// reads before deciding. And a NAMED container's drop appends a retraction of its declaration into the
// PRIMARY, so "your store is unchanged" is false at the delta level. The claim the code actually keeps
// is the one that matters to a person: the writes go with the store, and none of them crossed.
//
// The frame is CHROME, not confinement. It cannot stop untrusted markup from restyling or covering it —
// visual containment wants a sandboxed iframe, and a sandboxed iframe drops the same-origin credentials
// the §23.3 write path needs, so it is a later slice with its own design, not a flag flipped here. What
// the frame does guarantee is that the sequestration statement is IN the served bytes: an operator
// reading source, a screenshot diff, or a rail can all find it.

/** What a gateway serving a probationary route knows about its own sequestration (SPEC §24.7). */
export interface Probation {
  /** The declared container this pool is (SPEC §27). Absent for an anonymous `openQuarantine` pool. */
  readonly container?: string;
}

const escape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// The operator's promotion door. A frame does not re-implement promotion — it POINTS at the page where
// blessing law (§24.4) and adopting an output (§24.3) already live, because a second implementation of
// the only crossing is a second thing to get wrong.
const CONTAINER_PAGE = "/admin/container";

/**
 * The banner's own markup: the sequestration statement, and — on the operator's door only — the
 * promotion controls at its edge. `door` is the door the route was served through: an anonymous caller
 * gets the truth about what they are looking at, and no link into the operator's controls.
 */
export function probationBanner(p: Probation, door: "full" | "public"): string {
  const where =
    p.container === undefined
      ? "this quarantine pool"
      : `the quarantine pool &quot;${escape(p.container)}&quot;`;
  const controls =
    door !== "full"
      ? ""
      : p.container === undefined
        ? `<p data-loam-probation-controls="unnamed">This pool has no declared name, so no page can ` +
          `name it. Promote or drop it where it was opened.</p>`
        : `<p data-loam-probation-controls="named">` +
          `<a href="${CONTAINER_PAGE}?name=${encodeURIComponent(p.container)}">` +
          `Bless this app's law, adopt one of its outputs, or drop the pool</a></p>`;
  return (
    `<aside data-loam-probation="1" role="note" ` +
    `style="border:3px solid #b45309;background:#fffbeb;color:#1c1917;padding:.75rem;` +
    `font:14px/1.45 system-ui,sans-serif">` +
    `<strong>On probation.</strong> ` +
    `<span data-loam-probation-says="ground">This app is not your store's own law. ` +
    `It runs here, against your real ground, behind one-way glass.</span> ` +
    `<span data-loam-probation-says="writes">Its writes are LIVE: they land in ${where}, ` +
    `where this app reads them back. They are not in your store.</span> ` +
    `<span data-loam-probation-says="crossing">Promotion is the only crossing. Nothing it wrote ` +
    `reaches your canonical ground until you promote it.</span> ` +
    `<span data-loam-probation-says="drop">Drop the pool and this app's writes go with the store. ` +
    `Nothing it wrote crosses into your ground.</span>` +
    controls +
    `</aside>`
  );
}

// Where the banner goes in a renderer's own HTML. A v1 bundle may return a fragment or a whole
// document; the banner must be the FIRST thing in the body either way, so it is not scrolled past.
const BODY_OPEN = /<body\b[^>]*>/i;

/** Wrap a quarantined route's HTML in the frame (SPEC §24.7). */
export function frameProbation(html: string, p: Probation, door: "full" | "public"): string {
  const banner = probationBanner(p, door);
  const at = BODY_OPEN.exec(html);
  if (at !== null) {
    const cut = at.index + at[0].length;
    return html.slice(0, cut) + banner + html.slice(cut);
  }
  return `${banner}<div data-loam-probation-stage="1">${html}</div>`;
}
