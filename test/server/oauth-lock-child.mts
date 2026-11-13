import { withOAuthFile, type OAuthFile } from "../../src/server/oauth-file.js";

const [home, clientId, holdMs] = process.argv.slice(2);
if (home === undefined || clientId === undefined || holdMs === undefined) {
  console.error("oauth-lock-child: <home> <clientId> <holdMs>");
  process.exit(2);
}

try {
  withOAuthFile<undefined>(home, (file: OAuthFile) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
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
