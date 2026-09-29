// The single-peer image seam (step 6 host trial). A backend that can hold a peer image offers one
// `DurablePeerStore` per store object; the substrate plans, and the adapter commits the image and
// the newly admitted rows in one transaction.
//
// The image is the authority. Rows the image does not name are never served on this path, and an
// admitted id with no row fails the open (see `imageRows`).

import type { Delta, DurablePeerStore } from "@bombadil/rhizomatic";
import type { StoreBackend } from "./backend.js";

export interface PeerImageBackend extends StoreBackend {
  peerStore(): DurablePeerStore;
}

export function holdsPeerImages(backend: StoreBackend): backend is PeerImageBackend {
  return typeof (backend as Partial<PeerImageBackend>).peerStore === "function";
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

// The rows to serve, in the image's arrival order. A missing admitted row fails closed; an extra
// row is ignored.
export function imageRows(admittedInOrder: readonly string[], rows: readonly Delta[]): Delta[] {
  const byId = new Map(rows.map((d) => [d.id, d]));
  const missing = admittedInOrder.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new Error(
      `peer image: ${missing.length} admitted delta(s) have no stored row (first ${missing[0]}). ` +
        "The image is the authority, so the store refuses to open rather than serve a partial set.",
    );
  }
  return admittedInOrder.map((id) => byId.get(id)!);
}
