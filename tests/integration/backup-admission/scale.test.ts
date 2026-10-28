import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { z } from "zod";
import { fixtureIds } from "../../fixtures/foundation";
import { admissionTicketSchema } from "../../../services/operations/storage/postgres";
import { scaleFixture } from "./fixture";
import { bounded } from "../portable/process";

const write = (url: string, mode: string) => fetch(new URL(`/api/projects/${fixtureIds.project}?mode=${mode}`, url));
const resultSchema = z.object({ oid: z.string(), digest: z.string() });

test("two API processes drain a writer and hold SQL/blob/Git exclusion through a real archive", async () => {
  // Given an admitted writer in API one with a real SQL session and repository process.
  await using fixture = await scaleFixture();
  const entered = fixture.first.signal("writer");
  const writing = write(fixture.firstUrl, "hold");
  await entered;
  const closed = fixture.second.signal("closing");
  const snapshot = fixture.second.signal("snapshot");
  // When API two closes the PostgreSQL gate before waiting for that writer.
  const backup = fixture.second.call("backup");
  await Promise.race([closed, backup]);
  try {
    expect((await write(fixture.firstUrl, "normal")).status).toBe(503);
    await fixture.first.call("release-writer");
    const response = await writing;
    expect(response.status).toBe(200);
    const written = resultSchema.parse(await response.json());
    await Promise.race([snapshot, backup]);
    await rejects(fixture.first.call("sql", "UPDATE projects SET name='forbidden'"), /BACKUP_MAINTENANCE/);
    const rows = await fixture.observer.unsafe<{ name: string }[]>("SELECT name FROM projects WHERE id=$1", [fixtureIds.project]);
    expect(rows[0]?.name).toBe(written.oid);
    await fixture.second.call("release-backup");
    const archive = z.object({
      database: z.object({ tables: z.array(z.object({ name: z.string(), rows: z.array(z.record(z.string(), z.unknown())) })) }),
      manifest: z.object({ repositories: z.array(z.object({
        projectId: z.string(), objects: z.number(), refs: z.array(z.object({ ref: z.string() })),
      })) }),
    }).parse(await backup);
    // Then the complete archive selects precisely the already-published source state.
    expect(archive.database.tables.find(table => table.name === "projects")?.rows.find(row => row["id"] === fixtureIds.project)?.["name"]).toBe(written.oid);
    expect(archive.database.tables.find(table => table.name === "blobs")?.rows.some(row => row["digest"] === written.digest)).toBe(true);
    expect(archive.manifest.repositories[0]?.objects).toBeGreaterThan(0);
    expect(archive.manifest.repositories[0]?.refs.some(ref => ref.ref === "refs/quire/admission")).toBe(true);
    expect((await write(fixture.firstUrl, "normal")).status).toBe(200);
  } finally {
    await fixture.first.call("release-writer");
    await fixture.second.call("release-backup");
    await bounded(backup);
  }
}, 120000);

test("drains a live repository child after API lock loss and fences the resumed stale process", async () => {
  // Given a real Git child paused at execution while its API session owns admission.
  await using fixture = await scaleFixture();
  const beforeGit = fixture.first.signal("before-git");
  const child = fixture.pause("update-ref");
  const writing = write(fixture.firstUrl, "stale");
  const ticket = admissionTicketSchema.parse(await beforeGit);
  const socket = await child;
  fixture.first.child.kill("SIGSTOP");
  const closed = fixture.second.signal("closing");
  const sqlExclusive = fixture.second.signal("exclusive");
  let snapshotEntered = false;
  const snapshot = fixture.second.signal("snapshot").then(() => { snapshotEntered = true; });
  const backup = rejects(fixture.second.call("backup"), /BACKUP_RECOVERY_REQUIRED/);
  await Promise.race([closed, backup]);
  try {
    // When PostgreSQL forcibly loses the old session, SQL takeover alone is not enough.
    await fixture.observer.unsafe("SELECT pg_terminate_backend($1)", [ticket.pid]);
    await Promise.race([sqlExclusive, backup]);
    expect(snapshotEntered).toBe(false);
    socket.write("run\n");
    await Promise.race([snapshot, backup]);
    fixture.first.child.kill("SIGCONT");
    await fixture.first.call("release-writer");
    expect((await writing).status).not.toBe(200);
    // Then the old process cannot publish SQL or more Git objects into the snapshot.
    const rows = await fixture.observer.unsafe<{ name: string }[]>("SELECT name FROM projects WHERE id=$1", [fixtureIds.project]);
    expect(rows[0]?.name).toBe("Latent Dynamics Note");
    await fixture.second.call("release-backup");
    await backup;
    const intents = await fixture.observer.unsafe<{ id: string }[]>("SELECT id FROM repository_intents WHERE state='prepared'");
    const intent = z.object({ id: z.string() }).parse(intents[0]);
    const bytes = "stale forbidden object";
    const oid = new Bun.CryptoHasher("sha1").update(`blob ${bytes.length}\0${bytes}`).digest("hex");
    await rejects(fixture.first.call("objects", ["cat-file", "-e", oid]), /REPOSITORY_GIT_FAILED/);
    await fixture.observer.unsafe("UPDATE branch_leases SET expires_at='1970-01-01T00:00:00.000Z' WHERE project_id=$1", [fixtureIds.project]);
    await fixture.first.call("recover", intent.id);
    const archive = z.object({
      manifest: z.object({ repositories: z.array(z.object({ refs: z.array(z.object({ ref: z.string() })) })) }),
    }).parse(await fixture.second.call("backup"));
    expect(archive.manifest.repositories[0]?.refs.some(ref => ref.ref === "refs/quire/admission")).toBe(true);
    expect((await write(fixture.firstUrl, "normal")).status).toBe(200);
  } catch (error) {
    console.error("ADMISSION_STALE_FAILURE", error);
    throw error;
  } finally {
    socket.end("run\n");
    fixture.first.child.kill("SIGCONT");
    await fixture.first.call("release-writer");
    await fixture.second.call("release-backup");
    await bounded(backup);
  }
}, 120000);

test("releases both PostgreSQL and repository gates after callback failure", async () => {
  // Given API two has acquired both actual exclusion gates.
  await using fixture = await scaleFixture();
  const snapshot = fixture.second.signal("snapshot");
  const failed = rejects(fixture.second.call("failure"), /owned scale failure/);
  await snapshot;
  // When the callback fails after release of its explicit test barrier.
  expect((await write(fixture.firstUrl, "normal")).status).toBe(503);
  await fixture.second.call("release-backup");
  await failed;
  // Then a different API can mutate SQL and the real repository again.
  expect((await write(fixture.firstUrl, "normal")).status).toBe(200);
}, 120000);

test("rejects exclusive completion when the owning PostgreSQL session dies during its callback", async () => {
  // Given a real exclusive host paused inside its callback after both gates were acquired.
  await using fixture = await scaleFixture();
  const snapshot = fixture.second.signal("snapshot");
  const rejected = rejects(fixture.second.call("lease-loss"), /Connection closed|ADMISSION_EXPIRED/);
  const ticket = admissionTicketSchema.parse(await snapshot);
  // When the database removes the owner's session before the callback returns.
  await fixture.observer.unsafe("SELECT pg_terminate_backend($1)", [ticket.pid]);
  await fixture.second.call("release-backup");
  await rejected;
  // Then it cannot report successful exclusion, and a fresh writer can make progress.
  expect((await write(fixture.firstUrl, "normal")).status).toBe(200);
}, 120000);
