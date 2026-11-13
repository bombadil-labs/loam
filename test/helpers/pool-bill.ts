import { ENVELOPE_ANY, envelopeClaims } from "../../src/gateway/envelope.js";
import type { Gateway } from "../../src/gateway/gateway.js";

export const HOST_SIZED_BILL_MS = 10_000;

export async function declareHostSizedBill(gw: Gateway, timestamp: number): Promise<void> {
  await gw.append([
    gw.signer!.sign(
      envelopeClaims(
        ENVELOPE_ANY,
        { renderTimeoutMs: HOST_SIZED_BILL_MS },
        gw.operatorAuthor!,
        timestamp,
      ),
    ),
  ]);
}
