import { endpoints } from "@quire/contracts";
import type { FileEntry, Id } from "@quire/contracts";
import { editorValue } from "../shared";
import type { EditorDocument } from "../shared";
import { DocumentConnection } from "./connection";
import type { TransportOptions } from "./connection";
import { PersistentDocument, TransportError } from "./document";

export { TransportError } from "./document";
export type { TransportOptions, SocketFactory } from "./connection";
export interface EditorTransport {
  readonly open: (file: FileEntry) => Promise<EditorDocument>;
  readonly reconnect: () => void;
  readonly dispose: () => Promise<void>;
}
/** One controller per workspace; switching files reuses their queue, Doc and Awareness. */
export function createEditorTransport(options: TransportOptions): EditorTransport {
  const documents = new Map<Id, Promise<DocumentConnection>>();
  const abort = new AbortController();
  let disposed = false;
  return {
    async open(file) {
      if (disposed) throw new TransportError("CLOSED", "Transport disposed");
      if (!file.editable || file.kind !== "file") throw new TransportError("NOT_EDITABLE", "File is not editable text");
      let loading = documents.get(file.id);
      if (!loading) {
        loading = (async () => {
          const initial = editorValue(await options.client.call(endpoints.fileDocument, {
            params: { p: options.workspace.scope.projectId, f: file.id },
            query: { branch: options.workspace.scope.branch }, headers: options.workspace.requestHeaders, body: undefined,
          }, abort.signal));
          const connection = new DocumentConnection(options, new PersistentDocument(options.workspace, initial));
          connection.start();
          return connection;
        })();
        documents.set(file.id, loading);
        void loading.catch(() => { documents.delete(file.id); });
      }
      return (await loading).document;
    },
    reconnect() {
      for (const [id, loading] of documents) {
        void loading.then(connection => connection.reconnect(), () => { documents.delete(id); });
      }
    },
    async dispose() {
      disposed = true;
      abort.abort();
      const results = await Promise.allSettled(documents.values());
      await Promise.all(results.flatMap(result => result.status === "fulfilled" ? [result.value.dispose()] : []));
      documents.clear();
    },
  };
}
