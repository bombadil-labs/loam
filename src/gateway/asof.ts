import type { ResolvedNode } from "../surface/surface.js";

const MAX_LISTED_MOMENTS = 8;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function asOfBanner(node: ResolvedNode): string {
  const forgotten = node.forgotten ?? [];
  const listed = forgotten.slice(0, MAX_LISTED_MOMENTS).join(", ");
  const rest = forgotten.length - Math.min(forgotten.length, MAX_LISTED_MOMENTS);
  const confession =
    forgotten.length === 0
      ? ""
      : `<span data-loam-asof-says="forgotten">Since that moment this store lawfully forgot ` +
        `${plural(forgotten.length, "record", "records")}, at ${listed}` +
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
    `against the ground as of ${node.asOf} (milliseconds since 1970), not against ` +
    `the present.</span> ` +
    confession +
    slate +
    `</aside>`
  );
}

const BODY_OPEN = /<body\b[^>]*>/i;

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
