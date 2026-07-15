// Bytes in views — the self-describing envelope + the byte-door lookup (SPEC §23.7).
//
// rhizomatic 0.5.0's View can be a BytesView ({ mime, value: Uint8Array }): a schema that gathers a
// `bytes` Target resolves that field to raw bytes. Loam's view serializers pass a View through as JSON,
// and raw bytes are not JSON — so a bytes value crossing a door becomes a self-describing envelope
// { mime, ref, base64url? }. `ref` (the content address of the raw bytes) is ALWAYS present: the stable
// identity, the /bytes fetch key, and the consumer's cache key. `base64url` (rhizomatic's unpadded
// url-safe encoding — NOT padded base64) is present ONLY when the value is small enough to inline, so
// the field name self-describes the decode. The discriminant is `base64url` presence:
//   data = v.base64url ? b64uDecode(v.base64url) : fetch(mount + '/bytes/' + v.ref + '?from=…')
//   cacheKey = v.ref
// Inline is a pure optimization, never a different object. A future second encoding is an ADDITIVE key
// (e.g. `hex?`), never a breaking change to the envelope.
//
// One helper, reused by every seam: the gql ViewValue scalar, the REST node body, and the byte-door
// (which walks a re-resolved view for the BytesView a caller names by ref — the proof-of-read of §23.7).

import { b64uEncode, contentAddress, type BytesView } from "@bombadil/rhizomatic";

// Inline iff the raw value is this small; above it, the envelope is ref-only and the bytes ride the
// byte-door. A SERIALIZATION choice for bytes already in a delta — distinct from the (unbuilt) rule that
// binaries past a larger ceiling do not ride deltas at all. One exported const, trivially tunable.
export const INLINE_MAX = 512;

// A BytesView is a non-array object whose `value` is a Uint8Array (rhizomatic's own private predicate,
// replicated — it does not export it). The `mime` rides alongside as attested interpretation-testimony.
export function isBytesView(v: unknown): v is BytesView {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (v as { value?: unknown }).value instanceof Uint8Array
  );
}

// The content address of a bytes value — the SAME hash rhizomatic's bytes-target identity uses, so the
// ref a consumer reads in the envelope equals the ref the byte-door looks up. Hash the RAW bytes.
export function bytesRefOf(value: Uint8Array): string {
  return contentAddress(value);
}

// One BytesView → its envelope. `ref` always; `base64url` only when small (the inline rung).
function envelopeOf(v: BytesView): { mime: string; ref: string; base64url?: string } {
  const ref = bytesRefOf(v.value);
  return v.value.length <= INLINE_MAX
    ? { mime: v.mime, ref, base64url: b64uEncode(v.value) }
    : { mime: v.mime, ref };
}

// Deep-walk a resolved View, replacing every BytesView with its envelope and passing everything else
// through unchanged. Applied at each view→JSON seam (gql ViewValue, REST body) so no raw bytes leak.
// Idempotent: an envelope is a plain string-valued object, not a BytesView, so a second pass is a no-op.
export function bytesEnvelope(view: unknown): unknown {
  if (isBytesView(view)) return envelopeOf(view);
  if (Array.isArray(view)) return view.map((x) => bytesEnvelope(x));
  if (typeof view === "object" && view !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(view)) out[k] = bytesEnvelope(x);
    return out;
  }
  return view;
}

// Walk a resolved view for a BytesView whose content address is `ref` — the byte-door's lookup. The
// re-resolution IS the authorization (the caller could only have this ref by resolving this lens), so a
// hit means the bytes are lawfully theirs; a miss (unknown ref, erased source) is a uniform 404 upstream.
export function findBytesByRef(view: unknown, ref: string): BytesView | undefined {
  if (isBytesView(view)) return bytesRefOf(view.value) === ref ? view : undefined;
  if (Array.isArray(view)) {
    for (const x of view) {
      const hit = findBytesByRef(x, ref);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  if (typeof view === "object" && view !== null) {
    for (const x of Object.values(view)) {
      const hit = findBytesByRef(x, ref);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}
