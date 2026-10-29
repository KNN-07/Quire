import { expect, test } from "bun:test";
import { endpoints, resourceVersionTag, resultSchema } from "@quire/contracts";
import { baseFixture, okEnvelope } from "./harness";
import { postgresFixture } from "../review/postgres-fixture";
import { fixtureIds as ids } from "../../fixtures/foundation";
import { LoggedProcess } from "../../integration/portable/topology";
import { command } from "../../integration/portable/process";

test("PostgreSQL operator recovery preserves retained state and fences revoked authority across restart", async () => {
  const container = `quire-recovery-pg-${crypto.randomUUID()}`;
  let postgres: LoggedProcess | undefined;
  let created = false;
  try {
    await command(["docker", "create", "--name", container, "--label", "quire.qa=p47-recovery",
      "--publish", "127.0.0.1::5432", "--env", "POSTGRES_PASSWORD=quire-owned-recovery", "postgres:17-alpine"]);
    created = true;
    postgres = new LoggedProcess(["docker", "start", "--attach", container], process.env,
      /PostgreSQL init process complete;[\s\S]*database system is ready to accept connections/);
    await postgres.ready;
    const binding = await command(["docker", "port", container, "5432/tcp"]);
    const database = await postgresFixture(`postgres://postgres:quire-owned-recovery@${binding}/postgres`);
    try {
      // Given: real PostgreSQL, retained source/history and a link revoked by owner deletion.
      await using fixture = await baseFixture({ createAdapters: database.createAdapters });
      expect(fixture.runtime.db.dialect).toBe("postgres");
      const owner = await fixture.login();
      const operator = await fixture.login("operator@quire.local");
      await fixture.setPolicy(ids.project, { sharing: "anyone", anonymousRead: true });
      const project = await fixture.service.getProject(ids.project);
      const linkResponse = await fixture.request(`/api/projects/${ids.project}/link`, {
        method: "PUT", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID(),
          "if-match": resourceVersionTag(project.version) },
        body: JSON.stringify({ role: "viewer", expectedVersion: project.version }),
      });
      expect(linkResponse.status).toBe(200);
      const link = resultSchema(endpoints.accessLinkPut.output).parse(await linkResponse.json());
      if ("error" in link || !link.data.urlOnce) throw new TypeError("Expected created share link");
      const token = new URL(link.data.urlOnce).searchParams.get("share");
      if (!token) throw new TypeError("Expected share token");
      const files = await fixture.runtime.db.all("SELECT * FROM files ORDER BY id");
      const snapshots = await fixture.runtime.db.all("SELECT * FROM snapshots ORDER BY id");
      const members = await fixture.runtime.db.all("SELECT * FROM project_members ORDER BY id");
      const scope = { projectId: ids.project, branch: "main" };
      const source = await fixture.service.readDocument(scope, ids.mainFile);
      const current = await fixture.service.getProject(ids.project);
      const deletion = await fixture.request(`/api/projects/${ids.project}`, {
        method: "DELETE", headers: owner.headers,
        body: JSON.stringify({ confirmation: current.name, expectedVersion: current.version }),
      });
      expect(deletion.status).toBe(200);
      const version = okEnvelope.parse(await deletion.json()).data.version;
      const route = `/api/admin/projects/${ids.project}/restore`;
      const body = JSON.stringify({ confirmation: project.name, expectedVersion: version });
      const headers = { ...operator.headers, "idempotency-key": crypto.randomUUID() };
      expect((await fixture.request(route, {
        method: "POST", headers: { ...owner.headers, "idempotency-key": crypto.randomUUID() }, body,
      })).status).toBe(403);
      expect((await fixture.request(route, {
        method: "POST", headers: { cookie: operator.headers.cookie, "idempotency-key": crypto.randomUUID() }, body,
      })).status).toBe(403);
      const listing = await fixture.request(`/api/admin/projects/deleted?ownerId=${ids.kien}`, { headers: operator.headers });
      expect(listing.status).toBe(200);
      const page = resultSchema(endpoints.adminDeletedProjects.output).parse(await listing.json());
      if ("error" in page) throw new TypeError(page.error.message);
      expect(page.data.items).toContainEqual(expect.objectContaining({ id: ids.project, version }));

      // When: an audit failure aborts recovery, then the same request succeeds and replays after restart.
      await fixture.runtime.db.exec(`CREATE FUNCTION reject_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.event='project.restored' THEN RAISE EXCEPTION 'owned recovery audit failure'; END IF;
        RETURN NEW; END $$;
        CREATE TRIGGER recovery_audit_failure BEFORE INSERT ON audit_entries
        FOR EACH ROW EXECUTE FUNCTION reject_recovery_audit();`);
      expect((await fixture.request(route, { method: "POST", headers, body })).status).toBe(500);
      expect(await fixture.runtime.db.get("SELECT id FROM projects WHERE id=? AND deleted_at IS NULL", [ids.project])).toBeNull();
      expect(await fixture.runtime.db.get("SELECT actor_id FROM idempotency_results WHERE route=?", [`adminProjectRestore:${ids.project}`])).toBeNull();
      await fixture.runtime.db.exec("DROP TRIGGER recovery_audit_failure ON audit_entries; DROP FUNCTION reject_recovery_audit();");
      expect((await fixture.request(route, { method: "POST", headers, body })).status).toBe(200);
      await fixture.restart();
      expect((await fixture.request(route, { method: "POST", headers, body })).status).toBe(200);

      // Then: retained data survives once, while revoked links and operator demotion remain effective.
      expect(await fixture.runtime.db.all("SELECT * FROM files ORDER BY id")).toEqual(files);
      expect(await fixture.runtime.db.all("SELECT * FROM snapshots ORDER BY id")).toEqual(snapshots);
      expect(await fixture.runtime.db.all("SELECT * FROM project_members ORDER BY id")).toEqual(members);
      expect((await fixture.service.readDocument(scope, ids.mainFile)).text).toBe(source.text);
      expect((await fixture.service.getProject(ids.project)).version).toBe(version + 1);
      expect(await fixture.runtime.db.get("SELECT count(*)::integer AS total FROM audit_entries WHERE event='project.restored' AND target_id=?", [ids.project])).toEqual({ total: 1 });
      expect((await fixture.request(`/api/projects/${ids.project}/effective-access?branch=main`, {
        headers: { "x-project-token": token },
      })).status).toBe(404);
      expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: owner.headers })).status).toBe(200);
      expect((await fixture.request(`/api/projects/${ids.project}/files?branch=main`, { headers: operator.headers })).status).toBe(404);
      await fixture.runtime.db.run("UPDATE users SET operator=0 WHERE id=?", [ids.operator]);
      expect((await fixture.request(route, { method: "POST", headers, body })).status).toBe(403);
      console.info("P47_RECOVERY_PASS", JSON.stringify({ dialect: fixture.runtime.db.dialect,
        projectId: ids.project, version: version + 1, root: fixture.path, container, binding }));
    } finally { await database.close(); }
  } finally {
    if (postgres) await postgres.stop();
    if (created) await command(["docker", "rm", "--force", "--volumes", container]);
    console.info("P47_RECOVERY_CLEANED", container);
  }
}, 180000);
