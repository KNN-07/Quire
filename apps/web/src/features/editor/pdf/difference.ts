import { z } from "zod";
import { ArtifactSchema, IdSchema, endpoints } from "@quire/contracts";
import type { Id, Operation } from "@quire/contracts";
import { EditorApiError, editorValue } from "../shared";
import type { EditorClient, EditorWorkspace } from "../shared";
import { PdfEvents } from "./events";

export const PdfDifferenceSchema = z.object({
  artifactId: IdSchema, previewArtifactId: IdSchema, pages: z.array(ArtifactSchema),
  fromJobId: IdSchema, toJobId: IdSchema, mode: z.enum(["side-by-side", "overlay"]),
  regions: z.array(z.strictObject({ page: z.number().int().positive(), x: z.number(),
    y: z.number(), width: z.number(), height: z.number(), label: z.literal("visual difference") })),
}).readonly();
export type PdfDifference = z.infer<typeof PdfDifferenceSchema>;
export async function comparePdfs(input: {
  readonly client: EditorClient;
  readonly workspace: EditorWorkspace;
  readonly fromSnapshotId: Id;
  readonly toSnapshotId: Id;
  readonly mode: "side-by-side" | "overlay";
  readonly signal: AbortSignal;
}): Promise<PdfDifference> {
  const { client, workspace, signal } = input;
  const completion = Promise.withResolvers<Operation>();
  // Attach rejection observation before a synchronous abort/error can settle the signal.
  void completion.promise.catch(() => {});
  const events = new PdfEvents(client, workspace, error => completion.reject(error));
  let operationId: Id | null = null;
  const inspect = async () => {
    if (!operationId) return;
    const operation = editorValue(await client.call(endpoints.operationGet, {
      params: { id: operationId }, query: {}, body: undefined, headers: workspace.requestHeaders,
    }, signal));
    if (operation.status !== "queued" && operation.status !== "running") completion.resolve(operation);
  };
  const tasks = new Set<Promise<void>>();
  const unsubscribe = events.subscribe(event => {
    if (event.topic !== "operation.changed" || event.payload.resourceId !== operationId) return;
    const task = inspect().catch(error => completion.reject(error));
    tasks.add(task);
    void task.finally(() => tasks.delete(task));
  });
  const aborted = () => { completion.reject(signal.reason); void events.dispose(); };
  signal.addEventListener("abort", aborted, { once: true });
  try {
    signal.throwIfAborted();
    await events.connected();
    const operation = editorValue(await client.call(endpoints.pdfDiff, {
      params: { p: workspace.scope.projectId }, query: {},
      body: { fromSnapshotId: input.fromSnapshotId, toSnapshotId: input.toSnapshotId, mode: input.mode },
      headers: { ...workspace.requestHeaders, "idempotency-key": crypto.randomUUID() },
    }, signal));
    operationId = operation.id;
    // Read once after registration to cover completion before the POST response.
    await inspect();
    const result = await completion.promise;
    if (result.status !== "succeeded") throw new EditorApiError(result.errorCode ?? "PDF_DIFF_FAILED",
      `Rendered PDF comparison ${result.status}: ${result.errorCode ?? "no result"}`);
    return PdfDifferenceSchema.parse(result.result);
  } finally {
    signal.removeEventListener("abort", aborted);
    unsubscribe();
    await events.dispose();
    await Promise.all(tasks);
  }
}
