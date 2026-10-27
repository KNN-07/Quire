import { useEffect, useState } from "react";
import { endpoints } from "@quire/contracts";
import type { createClient, Result } from "@quire/contracts";

export type ProjectsPageProps = {
  readonly path: string;
  readonly client: ReturnType<typeof createClient>;
  readonly navigate: (path: string) => void;
  readonly onSessionChange: () => Promise<void>;
};
export class ProjectsApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ProjectsApiError";
  }
}
export function value<T>(result: Result<T>): T {
  if ("error" in result) throw new ProjectsApiError(result.error.code, result.error.message);
  return result.data;
}
export function errorMessage(error: unknown): string {
  if (error instanceof ProjectsApiError) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return "The request failed. Check your connection and retry.";
}
export const mutationHeaders = () => ({ "idempotency-key": crypto.randomUUID() });

export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void load(controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [load, revision]);
  return { data, error, loading, reload: () => setRevision(current => current + 1) };
}

export async function loadTemplates(client: ProjectsPageProps["client"], signal: AbortSignal) {
  const items = [];
  let cursor: string | undefined;
  do {
    const page = value(await client.call(endpoints.templatesList, {
      params: {}, query: { limit: 100, ...(cursor ? { cursor } : {}) }, body: undefined, headers: {},
    }, signal));
    items.push(...page.items.filter(item => item.status === "approved" || item.status === "published"));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
