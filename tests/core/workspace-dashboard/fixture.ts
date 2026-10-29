import type { CoreProjects } from "../../../services/core/base";
import { fixtureIds as ids } from "../../fixtures/foundation";

/** Persist real projects and memberships through the canonical native service. */
export async function workspaceProjects(service: CoreProjects) {
  const now = service.context.clock.now();
  await service.context.uow.run(async tx => {
    await tx.lock("quire:accounts");
    for (const [organizationId, userId] of [[ids.team, ids.mai], [ids.institution, ids.kien], [ids.institution, ids.outsider]] as const) {
      await tx.run("INSERT INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,'member',0,?)",
        [crypto.randomUUID(), organizationId, userId, now]);
    }
  });
  const personal = await service.create(ids.kien, { name: "Personal notebook", origin: { kind: "blank" } });
  const shared = await service.create(ids.mai, { name: "Shared personal notebook", origin: { kind: "blank" } });
  const team = await service.create(ids.kien, { name: "Workspace team notebook", workspaceId: ids.team, origin: { kind: "blank" } });
  const teamShared = await service.create(ids.mai, { name: "Workspace shared notebook", workspaceId: ids.team, origin: { kind: "blank" } });
  const teamHidden = await service.create(ids.mai, { name: "Hidden team notebook", workspaceId: ids.team, origin: { kind: "blank" } });
  const institution = await service.create(ids.kien, { name: "Institution notebook", workspaceId: ids.institution, origin: { kind: "blank" } });
  const institutionHidden = await service.create(ids.outsider, { name: "Hidden institution notebook", workspaceId: ids.institution, origin: { kind: "blank" } });
  for (const project of [shared, teamShared]) {
    await service.context.db.run("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,'viewer',?)",
      [crypto.randomUUID(), project.id, ids.kien, now]);
  }
  return { personal, shared, team, teamShared, teamHidden, institution, institutionHidden };
}
