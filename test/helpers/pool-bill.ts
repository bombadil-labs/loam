// The host-sized pool bill (T253). A POOL render charges worker SPAWN to the pool's DECLARED
// clock — "the envelope is the pool's whole bill" (renderers.ts) — so any fixture that asserts
// a pool render SUCCEEDS under a tight or default (500ms) bill is racing host scheduling, and
// loses on a loaded runner: render-ocap, probation-frame, and install-by-federation each paid
// that flake once. A fixture that asserts pool-render SUCCESS declares this bill; a fixture
// that asserts a CLOCK REFUSAL declares its own tight number and stays away from this helper.
//
// 10 seconds is §23.9's own sizing for worst-case host scheduling (RENDER_SPAWN_TIMEOUT_MS's
// rationale: a loaded 16-core box spawns in ~0.8s; CI runners are smaller and slower). The
// declaration is a delta on the PARENT's ground, wildcard subject, exactly the shape
// quarantine-envelope's own fixtures use.

import { signClaims } from "@bombadil/rhizomatic";
import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import type { Gateway } from "../../src/gateway/gateway.js";

export const HOST_SIZED_BILL_MS = 10_000;

/** Declare a wildcard pool envelope whose clock a loaded host can actually meet. */
export async function declareHostSizedBill(gw: Gateway, timestamp: number): Promise<void> {
  await gw.append([
    signClaims(
      envelopeClaims(
        ENVELOPE_ANY,
        { renderTimeoutMs: HOST_SIZED_BILL_MS },
        gw.operatorAuthor!,
        timestamp,
      ),
      gw.options.seed!,
    ),
  ]);
}
