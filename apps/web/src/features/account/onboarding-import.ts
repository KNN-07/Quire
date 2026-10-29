import { useCallback, useEffect, useRef, useState } from "react";
import { DigestSchema, endpoints, ImportFormSchema, OnboardingImportDraftSchema } from "@quire/contracts";
import type { Onboarding, OnboardingImportDraft, OnboardingImportFile, OnboardingImportRequest, Operation } from "@quire/contracts";
import { mutationHeaders, readInput, unwrap } from "./shared";
import type { AccountPageProps } from "./shared";
import { openOnboardingProject } from "./onboarding-progress";

export type OnboardingImportContinuation = {
  readonly draft: OnboardingImportDraft;
  readonly locked: boolean;
  readonly pending: boolean;
  readonly error: string;
  readonly operation: Operation | null;
  readonly requiredFile: OnboardingImportFile | null;
  readonly saveDraft: (draft: OnboardingImportDraft) => Promise<void>;
  readonly submit: (body?: FormData | OnboardingImportRequest) => Promise<Operation>;
};
async function fingerprint(file: File): Promise<OnboardingImportFile> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return { filename: file.name, mime: file.type || "application/octet-stream", bytes: file.size,
    sha256: DigestSchema.parse([...digest].map(byte => byte.toString(16).padStart(2, "0")).join("")) };
}

export function useOnboardingImport(props: AccountPageProps) {
  const [progress, setProgress] = useState<Onboarding | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const latest = useRef<Onboarding | null>(null);
  const queue = useRef(Promise.resolve());
  const blocked = useRef("");
  const accept = useCallback((saved: Onboarding) => { latest.current = saved; setProgress(saved); }, []);
  const recover = useCallback(async () => {
    const saved = latest.current;
    if (!saved) throw new Error("Onboarding is still loading.");
    const result = unwrap(await props.client.call(endpoints.onboardingImportRecover, {
      params: {}, query: {}, body: { actorId: saved.actorId },
    }));
    accept(result.progress); setOperation(result.operation);
    return result;
  }, [props.client, accept]);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      await queue.current;
      blocked.current = ""; setError("");
      const saved = unwrap(await props.client.call(endpoints.onboardingGet, readInput, signal));
      if (signal?.aborted) return;
      accept(saved);
      if (saved.importState?.attempt) await recover();
      else setOperation(null);
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [props.client, accept, recover]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted && cause instanceof Error) setError(cause.message);
    });
    return () => controller.abort();
  }, [load]);
  const saveDraft = useCallback(async (draft: OnboardingImportDraft) => {
    const parsed = OnboardingImportDraftSchema.parse(draft);
    setPending(count => count + 1);
    const work = queue.current.then(async () => {
      if (blocked.current) throw new Error(blocked.current);
      const saved = latest.current;
      if (!saved?.importState) throw new Error("Choose import in onboarding first.");
      if (JSON.stringify(parsed) === JSON.stringify(saved.importState.draft)) return;
      setError("");
      accept(unwrap(await props.client.call(endpoints.onboardingImportSave, { params: {}, query: {},
        body: { actorId: saved.actorId, expectedVersion: saved.version, draft: parsed }, headers: mutationHeaders() })));
    }).catch((cause: unknown) => {
      if (cause instanceof Error) { blocked.current = cause.message; setError(cause.message); }
      throw cause;
    });
    queue.current = work.then(() => undefined, () => undefined);
    try { await work; }
    finally { setPending(count => count - 1); }
  }, [props.client, accept]);
  async function submit(body?: FormData | OnboardingImportRequest): Promise<Operation> {
    if (!body) {
      const resumedOperation = await resume();
      if (!resumedOperation) throw new Error("Reselect the original file to complete its upload.");
      return resumedOperation;
    }
    await queue.current;
    if (blocked.current) throw new Error(blocked.current);
    let saved = latest.current;
    if (!saved?.importState) throw new Error("Choose import in onboarding first.");
    const parsed = body instanceof FormData ? ImportFormSchema.parse(body) : body;
    const sourceFile = parsed.source instanceof File ? parsed.source : null;
    if (!(parsed.source instanceof File) && parsed.source.kind !== "git") throw new Error("Choose the original ZIP or a saved Git connection.");
    const draft = OnboardingImportDraftSchema.parse({
      mode: parsed.kind === "zip" ? "upload" : parsed.kind, name: parsed.name,
      workspaceId: parsed.workspaceId ?? null,
      url: parsed.source instanceof File ? "" : parsed.source.kind === "git" ? parsed.source.url : "",
      branch: parsed.source instanceof File ? "main" : parsed.source.kind === "git" ? parsed.source.branch : "main",
      grantId: parsed.source instanceof File ? null : parsed.source.kind === "git" ? parsed.source.grantId ?? null : null,
      ...(parsed.mainPath ? { mainPath: parsed.mainPath } : {}),
      ...(parsed.engine ? { engine: parsed.engine } : {}),
      ...(parsed.environmentId ? { environmentId: parsed.environmentId } : {}),
      ...(parsed.preserveHistory !== undefined ? { preserveHistory: parsed.preserveHistory } : {}),
      ...(parsed.keepConnected !== undefined ? { keepConnected: parsed.keepConnected } : {}),
    });
    if (!saved.importState.attempt) {
      await saveDraft(draft);
      saved = latest.current;
      if (!saved) throw new Error("Onboarding is still loading.");
      saved = unwrap(await props.client.call(endpoints.onboardingImportStart, { params: {}, query: {},
        body: { actorId: saved.actorId, expectedVersion: saved.version, file: sourceFile ? await fingerprint(sourceFile) : null },
        headers: { "idempotency-key": `onboarding-import-start:${saved.actorId}:${saved.version}` } }));
      accept(saved);
    }
    let resumed = await recover();
    if (resumed.operation) return resumed.operation;
    let attempt = resumed.progress.importState?.attempt;
    if (!attempt) throw new Error("Saved import attempt is unavailable.");
    if (attempt.file && !attempt.upload) {
      if (!sourceFile || JSON.stringify(await fingerprint(sourceFile)) !== JSON.stringify(attempt.file)) {
        throw new Error(`Reselect the same ${attempt.file.filename} (${attempt.file.bytes} bytes) to resume its upload.`);
      }
      if (!attempt.uploadKey) throw new Error("Saved upload key is unavailable.");
      const form = new FormData();
      form.set("file", sourceFile);
      unwrap(await props.client.call(endpoints.importUploadCreate, { params: {}, query: {}, body: form,
        headers: { "idempotency-key": attempt.uploadKey } }));
      resumed = await recover();
      if (resumed.operation) return resumed.operation;
      attempt = resumed.progress.importState?.attempt;
    }
    if (!attempt?.request) throw new Error("The original upload has not completed.");
    const created = unwrap(await props.client.call(endpoints.importCreate, { params: {}, query: {}, body: attempt.request,
      headers: { "idempotency-key": attempt.key } }));
    setOperation(created);
    const complete = await recover();
    if (complete.operation?.id !== created.id) throw new Error("Import operation recovery did not match the real response.");
    return complete.operation;
  }
  async function resume(): Promise<Operation | null> {
    const resumed = await recover();
    if (resumed.operation) return resumed.operation;
    const attempt = resumed.progress.importState?.attempt;
    if (!attempt?.request) return null;
    const created = unwrap(await props.client.call(endpoints.importCreate, { params: {}, query: {}, body: attempt.request,
      headers: { "idempotency-key": attempt.key } }));
    setOperation(created);
    const result = await recover();
    if (result.operation?.id !== created.id) throw new Error("Import operation recovery did not match the real response.");
    return result.operation;
  }
  async function navigate(path: string) {
    const destination = new URL(path, location.origin);
    if (/^\/projects\/[^/]+\/edit$/u.test(destination.pathname)) {
      const resumed = await recover();
      if (resumed.progress.stage !== "complete" || destination.pathname !== `/projects/${resumed.progress.projectId}/edit`) {
        throw new Error("The imported project is not ready to open.");
      }
      await openOnboardingProject(props, resumed.progress);
    } else props.navigate(path);
  }
  const state = progress?.importState;
  const continuation: OnboardingImportContinuation | null = state ? {
    draft: state.draft, locked: Boolean(state.attempt), pending: pending > 0, error, operation,
    requiredFile: state.attempt && !state.attempt.upload ? state.attempt.file : null, saveDraft, submit,
  } : null;
  return { progress, continuation, loading, error, load, resume, navigate };
}
