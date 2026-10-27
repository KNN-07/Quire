import { useEffect, useRef, useState } from "react";
import type { Endpoint } from "@quire/contracts";
import type { z } from "zod";
import type { AdminClient, WireInput } from "./api";
import { errorMessage } from "./api";

/** Shared read lifecycle for the administration's typed resource panels. */
export function useAdminResource<I extends z.ZodType<WireInput>, O extends z.ZodType>(
  client: AdminClient, endpoint: Endpoint<I, O>, input: z.input<I>,
) {
  const currentInput = useRef(input);
  currentInput.current = input;
  const inputKey = JSON.stringify(input);
  const [resource, setResource] = useState<{
    readonly data: z.output<O>; readonly etag: string | null; readonly version: number | null;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void client.callWithMetadata(endpoint, currentInput.current, controller.signal).then(response => {
      if (controller.signal.aborted) return;
      if ("error" in response.result) { setError(response.result.error.message); setResource(null); }
      else setResource({ data: response.result.data, etag: response.metadata.etag, version: response.metadata.expectedVersion });
      setLoading(false);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) { setError(errorMessage(failure)); setResource(null); setLoading(false); }
    });
    return () => controller.abort();
  }, [client, endpoint, inputKey, revision]);
  return { resource, error, loading, refresh: () => setRevision(value => value + 1) };
}
