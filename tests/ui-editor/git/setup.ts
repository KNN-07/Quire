import { join } from "node:path";
import { endpoints, resultSchema } from "@quire/contracts";
import type { BrowserContext, Page } from "@playwright/test";
import type { Id, Project } from "@quire/contracts";
import { editorValue } from "../../../apps/web/src/features/editor/shared";
import { CoreProjects } from "../../../services/core/base";
import type {
  EditorApplication, authenticatedContext,
} from "../shared";

export type Actor = Awaited<ReturnType<typeof authenticatedContext>>;

export async function firstProject(context: BrowserContext): Promise<Project> {
  const response = await context.request.get("/api/projects?owner=all&state=active&sort=updated&direction=desc&limit=200");
  const projects = editorValue(resultSchema(endpoints.projectList.output).parse(await response.json())).items;
  const project = projects.find(item => item.name === "Latent Dynamics Note") ?? projects[0];
  if (!project) throw new TypeError("Seed project missing");
  return project;
}

export function projectService(app: EditorApplication): CoreProjects {
  const service = app.application.runtime.services.get("projects");
  if (!(service instanceof CoreProjects)) throw new TypeError("Core project service missing");
  return service;
}

async function requestJson(context: BrowserContext, input: {
  readonly method: "POST" | "PUT";
  readonly path: string;
  readonly csrf: string;
  readonly origin: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly idempotent?: boolean;
  readonly ifMatch?: number;
}) {
  return context.request.fetch(input.path, {
    method: input.method,
    headers: {
      origin: input.origin,
      "x-csrf-token": input.csrf,
      ...(input.idempotent ? { "idempotency-key": crypto.randomUUID() } : {}),
      ...(input.ifMatch === undefined ? {} : { "if-match": `"v${input.ifMatch}"` }),
    },
    data: input.body,
  });
}

export async function prepareTwoHunks(app: EditorApplication, actor: Actor, project: Project) {
  const scope = { projectId: project.id, branch: "main" };
  const initial = await actor.context.request.get(`/api/projects/${project.id}/git/status?branch=main`);
  const first = editorValue(resultSchema(endpoints.gitStatus.output).parse(await initial.json()));
  const version = Number(initial.headers()["etag"]?.replace(/\D/g, ""));
  const service = projectService(app);
  const baseline = `\\documentclass{article}\n\\begin{document}\n${
    Array.from({ length: 24 }, (_, index) => `Line ${index}.\\par\n`).join("")
  }\\end{document}\n`;
  await service.serialized(scope, async lease => service.commitSource({
    lease, actorId: actor.session.user.id, scope, expectedRevision: version,
    inputs: (await service.listFiles(scope)).map(file => ({
      file, ...(file.id === project.settings.mainFileId
        ? { bytes: new TextEncoder().encode(baseline) } : {}),
    })),
  }));
  const statusResponse = await actor.context.request.get(`/api/projects/${project.id}/git/status?branch=main`);
  const status = editorValue(resultSchema(endpoints.gitStatus.output).parse(await statusResponse.json()));
  const revision = Number(statusResponse.headers()["etag"]?.replace(/\D/g, ""));
  const staged = await requestJson(actor.context, {
    method: "PUT", path: `/api/projects/${project.id}/git/stage`, csrf: actor.session.csrfToken,
    origin: app.url.origin,
    ifMatch: revision, body: {
      scope, head: status.head, hunkIds: status.hunks.map(hunk => hunk.id),
      staged: true, expectedVersion: revision,
    },
  });
  if (staged.status() !== 200) throw new TypeError(`Baseline stage failed: ${await staged.text()}`);
  const committed = await requestJson(actor.context, {
    method: "POST", path: `/api/projects/${project.id}/git/commit`, csrf: actor.session.csrfToken,
    origin: app.url.origin,
    idempotent: true, body: {
      scope, head: status.head, message: "Browser baseline", compileFirst: false, expectedVersion: revision,
    },
  });
  if (committed.status() !== 202) throw new TypeError(`Baseline commit failed: ${await committed.text()}`);
  const changed = baseline.replace("Line 1.", "First browser edit.").replace("Line 22.", "Last browser edit.");
  await service.serialized(scope, async lease => service.commitSource({
    lease, actorId: actor.session.user.id, scope,
    expectedRevision: (await service.getBranch(scope)).revision,
    inputs: (await service.listFiles(scope)).map(file => ({
      file, ...(file.id === project.settings.mainFileId
        ? { bytes: new TextEncoder().encode(changed) } : {}),
    })),
  }));
  return { scope, baseline, changed, initialHead: first.head };
}

export async function mountGit(page: Page, projectId: Id, branch = "main"): Promise<void> {
  await page.goto(`/projects?gitProject=${projectId}&gitBranch=${encodeURIComponent(branch)}`, {
    waitUntil: "domcontentloaded",
  });
  const modulePath = `/@fs${join(process.cwd(), "tests/ui-editor/git/harness.tsx")}`;
  await page.evaluate(async path => {
    const module = await import(path);
    await module.mountGitHarness();
  }, modulePath);
  await page.getByTestId("git-harness-ready").waitFor({ state: "visible" });
  const text = await page.evaluate(() => new Promise<string>((resolve, reject) => {
    const observer = new MutationObserver(check);
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Git harness did not settle: ${document.body.innerText}`));
    }, 30_000);
    function check() {
      const bodyText = document.body.innerText.toLowerCase();
      if (!bodyText.includes("clone with git") && !bodyText.includes("git workspace unavailable")) return;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(document.body.innerText);
    }
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }));
  if (!text.toLowerCase().includes("clone with git")) throw new TypeError(text);
}

export async function gitCli(args: readonly string[], cwd: string) {
  const child = Bun.spawn(["git", "-c", "credential.helper=", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore",
    env: {
      ...process.env, GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  const [out, error, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { out, error, code };
}
