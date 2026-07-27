// A SECOND OS PROCESS that contends for `oauth.json`'s lock — the only way to test a cross-process
// lock honestly.
//
// One process cannot prove this. `withOAuthFile`'s callback is synchronous by design and the CLI's
// revoke is synchronous throughout, so two of them on one thread can never interleave: a rail that
// runs both here passes whether or not anything locks, which is exactly the hollow shape.
//
// Run as: node --import tsx oauth-lock-child.mts <home> <clientId> <holdMs>
//
// It registers one client under the lock, busy-waits inside the locked section so the parent's own
// acquire genuinely overlaps it, and exits 0. A busy wait rather than a sleep because the callback is
// synchronous — which is the property under test.

import { withOAuthFile, type OAuthFile } from "../../src/server/oauth-file.js";

const [home, clientId, holdMs] = process.argv.slice(2);
if (home === undefined || clientId === undefined || holdMs === undefined) {
  console.error("oauth-lock-child: <home> <clientId> <holdMs>");
  process.exit(2);
}

try {
  withOAuthFile<undefined>(home, (file: OAuthFile) => {
    const until = Date.now() + Number(holdMs);
    while (Date.now() < until) {
      // hold the lock, on purpose
    }
    return {
      next: {
        ...file,
        clients: [
          ...file.clients,
          {
            clientId,
            clientName: clientId,
            redirectUris: ["https://claude.ai/child"],
            registeredAt: Date.now(),
            generation: 1,
          },
        ],
      },
      result: undefined,
    };
  });
  process.exit(0);
} catch (err) {
  console.error(`oauth-lock-child: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
