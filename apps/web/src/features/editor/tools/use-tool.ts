import { useCallback, useState, useSyncExternalStore } from "react";
import { ZodError } from "zod";
import type { ToolsPanelProps } from "../shared";
import { toolBlocked } from "./actions";

const subscribeEmpty = () => () => {};
const emptySnapshot = () => null;

export function useTool(props: ToolsPanelProps) {
  useSyncExternalStore(props.document?.subscribe ?? subscribeEmpty, props.document?.getSnapshot ?? emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    setError("");
    try { await action(); }
    catch (caught) {
      if (!(caught instanceof Error)) throw caught;
      setError(caught instanceof ZodError ? caught.issues.map(issue => issue.message).join("; ") : caught.message);
    } finally { setBusy(false); }
  }, []);
  return { busy, message, error, run, setMessage, blocked: toolBlocked(props),
    canWrite: props.workspace.access.capabilities.edit && !toolBlocked(props) && !busy };
}

export type ToolState = ReturnType<typeof useTool>;
