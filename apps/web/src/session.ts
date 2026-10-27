import { createClient, endpoints } from "@quire/contracts";
import type { ResponseOf } from "@quire/contracts";

export type SessionSnapshot = ResponseOf<typeof endpoints.me> | null;

export function createSession(baseUrl = "") {
  let snapshot: SessionSnapshot = null;
  const client = createClient(baseUrl, { csrfToken: () => snapshot?.csrfToken ?? null });
  return {
    client,
    get snapshot() { return snapshot; },
    async refresh(signal?: AbortSignal): Promise<SessionSnapshot> {
      const result = await client.call(endpoints.me, { params: {}, query: {}, body: undefined }, signal);
      if ("error" in result) {
        snapshot = null;
        if (result.error.code !== "UNAUTHENTICATED") throw new Error(`${result.error.code}: ${result.error.message}`);
      } else snapshot = result.data;
      return snapshot;
    },
  };
}
