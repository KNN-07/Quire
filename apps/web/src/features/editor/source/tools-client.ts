import type { Endpoint } from "@quire/contracts";
import { EditorApiError } from "../shared";
import type { EditorClient } from "../shared";

/** Tools can read and manage the personal Library, but cannot mutate project files
 * while Source is tracking. Check at dispatch, including actions begun earlier. */
export function sourceToolsClient(client: EditorClient, blocked: () => boolean): EditorClient {
  const check = (route: Endpoint) => {
    if (blocked() && route.method !== "GET" && route.path.startsWith("/api/projects/")) {
      throw new EditorApiError("SOURCE_MUTATION_BLOCKED",
        "Project file changes, citation copies and uploads are unavailable while Track changes is on or the source context is changing. Pause tracking first; your local draft is retained.");
    }
  };
  return {
    url(route, input) { return client.url(route, input); },
    async call(route, input, signal) {
      check(route);
      return client.call(route, input, signal);
    },
    async callWithMetadata(route, input, signal) {
      check(route);
      return client.callWithMetadata(route, input, signal);
    },
  };
}
