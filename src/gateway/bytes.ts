import { b64uEncode, contentAddress, type BytesView } from "@bombadil/rhizomatic";

export const INLINE_MAX = 512;

export function isBytesView(v: unknown): v is BytesView {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    (v as { value?: unknown }).value instanceof Uint8Array
  );
}

export function bytesRefOf(value: Uint8Array): string {
  return contentAddress(value);
}

function envelopeOf(v: BytesView): { mime: string; ref: string; base64url?: string } {
  const ref = bytesRefOf(v.value);
  return v.value.length <= INLINE_MAX
    ? { mime: v.mime, ref, base64url: b64uEncode(v.value) }
    : { mime: v.mime, ref };
}

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
