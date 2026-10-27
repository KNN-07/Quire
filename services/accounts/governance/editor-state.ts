import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

export function editorState(context: ModuleContext) {
  const value = context.db.query("SELECT value_json,version FROM operator_settings WHERE key='editor-state'").get();
  if (!value) return { closed: false, message: "", version: 0 };
  const row = z.object({ value_json: z.string(), version: z.number() }).parse(value);
  const state = z.object({ closed: z.boolean(), message: z.string() }).parse(JSON.parse(row.value_json));
  return { ...state, version: row.version };
}
export function requireEditorOpen(context: ModuleContext): void {
  const state = editorState(context);
  if (state.closed) throw new ServiceError("EDITOR_CLOSED", 503, state.message || "Editing is temporarily closed");
}
