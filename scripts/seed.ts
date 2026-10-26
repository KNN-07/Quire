import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import * as Y from "yjs";
import { IdSchema, DigestSchema, CompileSettingsSchema, EnvironmentSchema, assertNever } from "@quire/contracts";
import type { Runtime } from "@quire/runtime";
import { createRuntime, loadConfig, referenceBlob, StorageError } from "@quire/runtime";
import { fixtureIds as ids, seedUsers, defaultPolicy, defaultPreferences, exampleFiles } from "../tests/fixtures/foundation";

async function git(args: readonly string[], cwd: string): Promise<string> {
  const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe",
    env: { PATH: process.env["PATH"], GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(),
    new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new StorageError("SEED_GIT_FAILED", `${args[0]}: ${err}`);
  return out.trim();
}
async function seedProject(runtime: Runtime): Promise<void> {
  if (runtime.db.query("SELECT id FROM projects WHERE id=?").get(ids.project)) return;
  const work = await mkdtemp(join(runtime.config.dataDir, "work", "seed-"));
  try {
    const files = await Promise.all(exampleFiles.map(async (entry) => {
      switch (entry.kind) {
        case "folder":
          await mkdir(join(work, entry.path), { recursive: true });
          return { ...entry, bytes: new Uint8Array(), digest: null, state: new Uint8Array(), vector: new Uint8Array() };
        case "file": break;
        default: assertNever(entry);
      }
      const bytes = await readFile(new URL(`../tests/fixtures/example/${entry.path}`, import.meta.url));
      await mkdir(join(work, entry.path, ".."), { recursive: true });
      await Bun.write(join(work, entry.path), bytes);
      const digest = await runtime.blobs.put(bytes);
      const doc = new Y.Doc();
      doc.getText("source").insert(0, bytes.toString("utf8"));
      const state = Y.encodeStateAsUpdate(doc);
      const vector = Y.encodeStateVector(doc);
      doc.destroy();
      return { ...entry, bytes, digest, state, vector };
    }));
    await git(["init", "-b", "main"], work);
    await git(["config", "user.name", "Kien Nguyen"], work);
    await git(["config", "user.email", "kien@quire.local"], work);
    await git(["add", "."], work);
    await git(["commit", "-m", "Seed Latent Dynamics Note"], work);
    const head = await git(["rev-parse", "HEAD"], work);
    const tree = await git(["rev-parse", "HEAD^{tree}"], work);
    const repository = join(runtime.config.dataDir, "git", `${ids.project}.git`);
    await git(["clone", "--bare", work, repository], work);
    await git(["--git-dir", repository, "config", "transfer.hideRefs", "refs/quire"], work);
    await git(["--git-dir", repository, "update-ref", "refs/quire/history/main", head], work);
    const now = runtime.clock.now();
    const settings = CompileSettingsSchema.parse({
      engine: "pdflatex", mainFileId: ids.mainFile, environmentId: ids.environment,
      draft: false, stopOnFirstError: false,
    });
    runtime.uow.local((db) => {
      db.query("INSERT INTO projects(id,name,owner_id,workspace_id,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(ids.project, "Latent Dynamics Note", ids.kien, ids.team, JSON.stringify(settings), now, now);
      db.query("INSERT INTO branch_workspaces(id,project_id,branch,created_at,updated_at) VALUES(?,?,?,?,?)")
        .run(ids.branch, ids.project, "main", now, now);
      for (const user of seedUsers) {
        switch (user.role) {
          case null:
          case "owner": break;
          case "editor":
          case "reviewer":
          case "viewer":
            db.query("INSERT INTO project_members(id,project_id,user_id,role,created_at) VALUES(?,?,?,?,?)")
              .run(crypto.randomUUID(), ids.project, user.id, user.role, now);
            break;
          default: assertNever(user);
        }
      }
      for (const file of files) {
        if (file.digest) referenceBlob(db, { digest: file.digest, bytes: file.bytes.length }, runtime.clock);
        db.query("INSERT INTO files(id,branch_id,path,kind,mime,blob,bytes,editable,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
          .run(file.id, ids.branch, file.path, file.kind, file.mime, file.digest, file.bytes.length, Number(file.editable), now, now);
        if (file.editable) db.query("INSERT INTO document_states(doc_id,file_id,branch_id,text,state,state_vector,updated_at) VALUES(?,?,?,?,?,?,?)")
          .run(crypto.randomUUID(), file.id, ids.branch, new TextDecoder().decode(file.bytes), file.state, file.vector, now);
      }
      db.query("INSERT INTO repositories(project_id,relative_path,created_at) VALUES(?,?,?)").run(ids.project, `git/${ids.project}.git`, now);
      db.query("INSERT INTO branch_heads(project_id,branch,head) VALUES(?,?,?)").run(ids.project, "main", `sha1:${head}`);
      db.query("INSERT INTO snapshots(id,project_id,branch,revision,tree,author_id,reason,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(ids.snapshot, ids.project, "main", 0, `sha1:${tree}`, ids.kien, "checkpoint", now);
      db.query("INSERT INTO snapshot_files(snapshot_id,file_id,path,kind,mime,blob,bytes,editable,revision,epoch) SELECT ?,id,path,kind,mime,blob,bytes,editable,revision,epoch FROM files WHERE branch_id=?")
        .run(ids.snapshot, ids.branch);
    });
  } finally { await rm(work, { recursive: true, force: true }); }
}
export async function seed(runtime: Runtime, password?: string): Promise<{ readonly createdUsers: number; readonly password: string | null }> {
  if (runtime.config.production || !["127.0.0.1", "localhost", "::1"].includes(runtime.config.host)) {
    throw new StorageError("LOCAL_SEED_ONLY", runtime.config.host);
  }
  const missing = seedUsers.filter((user) => !runtime.db.query("SELECT id FROM users WHERE id=?").get(user.id));
  const localPassword = password ?? Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
  if (localPassword.length < 12) throw new StorageError("SEED_PASSWORD_TOO_SHORT", "minimum 12 characters");
  const hash = missing.length ? await Bun.password.hash(localPassword, { algorithm: "argon2id" }) : null;
  const now = runtime.clock.now();
  runtime.uow.local((db) => {
    for (const org of [{ id: ids.team, slug: "robotics-lab", name: "Robotics Lab", kind: "team" }, { id: ids.institution, slug: "quire-institute", name: "Quire Institute", kind: "institution" }]) {
      db.query("INSERT OR IGNORE INTO organizations(id,slug,name,kind,policy_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
        .run(org.id, org.slug, org.name, org.kind, JSON.stringify(defaultPolicy), now, now);
    }
    for (const user of missing) {
      db.query("INSERT INTO users(id,name,primary_email,password_hash,latex_name,operator,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(user.id, user.name, user.email, hash, user.name, Number(user.operator), now, now);
      db.query("INSERT INTO verified_emails(id,user_id,email,verified_at) VALUES(?,?,?,?)").run(crypto.randomUUID(), user.id, user.email, now);
      db.query("INSERT INTO preferences(user_id,value_json,updated_at) VALUES(?,?,?)").run(user.id, JSON.stringify(defaultPreferences), now);
    }
    const environment = EnvironmentSchema.parse({ id: ids.environment, label: "TeX Live 2025 (not probed)",
      release: "2025", backend: "bwrap", rootOrImageDigest: "", engines: ["pdflatex", "latex", "xelatex", "lualatex"],
      helpers: [], packagesDigest: DigestSchema.parse("0".repeat(64)), experimental: false, available: false, probeAt: null });
    db.query("INSERT OR IGNORE INTO environments(id,label,release,backend,manifest_json,available,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(ids.environment, environment.label, "2025", "bwrap", JSON.stringify(environment), 0, now);
    db.query("INSERT OR IGNORE INTO members(id,organization_id,user_id,role,licensed,created_at) VALUES(?,?,?,?,?,?)")
      .run(IdSchema.parse("00000000-0000-4000-8000-000000000050"), ids.team, ids.kien, "admin", 1, now);
  });
  await seedProject(runtime);
  return { createdUsers: missing.length, password: missing.length ? localPassword : null };
}
if (import.meta.main) {
  const runtime = await createRuntime(loadConfig());
  try {
    const result = await seed(runtime, process.env["QUIRE_SEED_PASSWORD"]);
    console.info("seed.persisted", { createdUsers: result.createdUsers, projectId: ids.project });
    if (result.password) console.info("Local seed password (displayed once):", result.password);
  } finally { runtime.close(); }
}
