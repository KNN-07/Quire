import type { ServiceModule } from "@quire/runtime";
import { register as updates, migrations as updateMigrations } from "./updates";
import { register as support, migrations as supportMigrations } from "./support";

export { register as registerSupport, startSupport, stopSupport } from "./support";

/** Installation safety and inquiry delivery stay fail-closed without their host authority. */
export const operationalModules: readonly ServiceModule[] = [
  { id: "070-o-updates", lane: "O", order: 70, register: updates, migrations: updateMigrations },
  { id: "085-o-support", lane: "O", order: 85, register: support, migrations: supportMigrations },
];
