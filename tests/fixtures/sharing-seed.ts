import type { Runtime } from "@quire/runtime";
import { seed } from "../../scripts/seed";
import { defaultPolicy, fixtureIds as ids } from "./foundation";

/** Sharing suites need a permissive creation ceiling, then exercise live restrictions. */
export async function seedSharingProject(runtime: Runtime, password: string) {
  const now = runtime.clock.now();
  await runtime.db.run(`INSERT INTO organizations(id,slug,name,kind,policy_json,created_at,updated_at)
    VALUES(?, 'robotics-lab', 'Robotics Lab', 'team', ?, ?, ?) ON CONFLICT DO NOTHING`,
  [ids.team, JSON.stringify({ ...defaultPolicy, sharing: "anyone" }), now, now]);
  const result = await seed(runtime, password);
  await runtime.db.run("UPDATE organizations SET policy_json=? WHERE id=?", [JSON.stringify(defaultPolicy), ids.team]);
  return result;
}
