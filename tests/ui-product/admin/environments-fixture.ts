import { endpoints, EnvironmentSchema, FileEntrySchema, ProjectSummarySchema, resourceVersionTag } from "@quire/contracts";
import { fixtureIds } from "../../fixtures/foundation";

export function environmentsFixture() {
  const requestId = "00000000-0000-4000-8000-000000000702";
  let version = 13;
  let environments = [EnvironmentSchema.parse({
    id: "00000000-0000-4000-8000-000000000701", label: "TeX Live fixture",
    release: "2025", backend: "bwrap", rootOrImageDigest: "/fixture/tex",
    engines: ["pdflatex", "xelatex", "lualatex"], helpers: ["biber"],
    packagesDigest: "a".repeat(64), experimental: false, available: true,
    probeAt: "2026-10-26T00:00:00.000Z",
  })];
  return (request: Request, url: URL, body: unknown): Response | null => {
    if (["/api/projects", "/api/admin/projects"].includes(url.pathname) && request.method === "GET") {
      const project = ProjectSummarySchema.parse({
        id: fixtureIds.project, name: "Typography samples", ownerId: fixtureIds.kien, ownerName: "Kien",
        workspaceId: null, defaultBranch: "main", version: 4, tagIds: [], role: "owner",
        createdAt: "2026-10-26T00:00:00.000Z", updatedAt: "2026-10-26T00:00:00.000Z",
        settings: { engine: "xelatex", mainFileId: fixtureIds.mainFile, environmentId: fixtureIds.environment,
          draft: false, stopOnFirstError: false },
      });
      const { ownerName: _owner, tagIds: _tags, role: _role, ...base } = project;
      return Response.json({ requestId, data: { items: [url.pathname === "/api/admin/projects" ? base : project], nextCursor: null } });
    }
    if (url.pathname === `/api/projects/${fixtureIds.project}/files`) {
      return Response.json({ requestId, data: [FileEntrySchema.parse({
        id: fixtureIds.mainFile, path: "fonts/Example.otf", kind: "file", mime: "font/otf",
        blob: "a".repeat(64), bytes: 128, editable: false, version: { revision: 2, epoch: 0 }, link: null,
      })] });
    }
    if (!url.pathname.startsWith("/api/admin/environments")) return null;
    const headers = { etag: resourceVersionTag(version) };
    if (request.method === "GET") return Response.json({ requestId, data: { items: environments, nextCursor: null } }, { headers });
    if (request.headers.get("x-csrf-token") !== "fixture-csrf") return Response.json({ requestId, error: { code: "FORBIDDEN", message: "Missing fixture CSRF" } }, { status: 403 });
    if (url.pathname === "/api/admin/environments/build") {
      endpoints.environmentBuild.input.parse({ params: {}, query: {}, body });
      return Response.json({ requestId, data: { id: crypto.randomUUID(), kind: "environment.build", status: "queued",
        progress: 0, result: null, errorCode: null } }, { status: 202 });
    }
    if (url.pathname === "/api/admin/environments") {
      const parsed = endpoints.environmentCreate.input.parse({ params: {}, query: {}, body });
      const environment = EnvironmentSchema.parse({ ...parsed.body.manifest, available: false, probeAt: null });
      environments = [...environments, environment]; version += 1;
      return Response.json({ requestId, data: environment });
    }
    const id = url.pathname.split("/")[4];
    const endpoint = url.pathname.endsWith("/retire") ? endpoints.environmentRetire : endpoints.environmentDefault;
    const parsed = endpoint.input.parse({ params: { id }, query: {}, body });
    if (parsed.body.expectedVersion !== version) return Response.json({ requestId, error: { code: "STALE_VERSION", message: "Refresh environments" } }, { status: 409 });
    if (url.pathname.endsWith("/retire")) environments = environments.map(item => item.id === id ? { ...item, available: false } : item);
    version += 1;
    return Response.json({ requestId, data: { ok: true, version } });
  };
}
