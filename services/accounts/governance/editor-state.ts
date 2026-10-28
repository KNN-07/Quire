import { z } from "zod";
import { ServiceError } from "@quire/runtime";
import type { ModuleContext } from "@quire/runtime";

export async function editorState(context: ModuleContext) {
  const value = (await context.db.get("SELECT value_json,version FROM operator_settings WHERE key='editor-state'", []));
  if (!value) return { closed: false, message: "", version: 0 };
  const row = z.object({ value_json: z.string(), version: z.number() }).parse(value);
  const state = z.object({ closed: z.boolean(), message: z.string() }).parse(JSON.parse(row.value_json));
  return { ...state, version: row.version };
}
export async function requireEditorOpen(context: ModuleContext): Promise<void> {
  const state = (await editorState(context));
  if (state.closed) throw new ServiceError("EDITOR_CLOSED", 503, state.message || "Editing is temporarily closed");
}
