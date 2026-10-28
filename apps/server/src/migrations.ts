import { foundationMigrations } from "@quire/runtime";
import { createApplicationAdapters } from "../../../services/adapters";
import { modules } from "./composition";

/** Full default schema inventory without registering or starting producers. */
export async function applicationMigrations() {
  const adapters = createApplicationAdapters({});
  try {
    const catalog = [...modules, ...adapters.modules].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    return [...await foundationMigrations(),
      ...catalog.flatMap(module => module.migrations ?? [])];
  } finally { await adapters.close(); }
}
