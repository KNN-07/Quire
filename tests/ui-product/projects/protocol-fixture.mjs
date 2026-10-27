import assert from "node:assert/strict";
import { endpoints, ProjectSchema } from "@quire/contracts";
import { zipSync } from "fflate";

export const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  shared: "10000000-0000-4000-8000-000000000003",
  tag: "10000000-0000-4000-8000-000000000004",
  template: "10000000-0000-4000-8000-000000000005",
  environment: "10000000-0000-4000-8000-000000000006",
};
export function createFixture() {
  const make = (name, id = crypto.randomUUID()) => ({
    id, name, ownerId: ids.owner, workspaceId: null, defaultBranch: "main",
    settings: { engine: "pdflatex", mainFileId: crypto.randomUUID(), environmentId: ids.environment, draft: false, stopOnFirstError: false },
    version: 1, createdAt: "2026-10-26T10:00:00Z", updatedAt: "2026-10-26T11:00:00Z",
  });
  const projects = [
    { ...make("Latent Dynamics Note", ids.project), version: 3, ownerName: "You", tagIds: [ids.tag], role: "owner", state: "active" },
    { ...make("Lab seminar", ids.shared), version: 7, ownerName: "Mai Tran", tagIds: [], role: "editor", state: "active" },
  ];
  const tags = [{ id: ids.tag, name: "Papers", colorHex: "#2F4FD6", version: 1 }];
  const templates = [
    { id: ids.template, templateId: crypto.randomUUID(), snapshotId: crypto.randomUUID(), name: "Conference paper", category: "Papers", description: "Two-column layout with anonymised review mode.", license: "CC-BY-4.0", visibility: "public", status: "published", organizationId: null, version: 2 },
    { id: crypto.randomUUID(), templateId: crypto.randomUUID(), snapshotId: crypto.randomUUID(), name: "Thesis", category: "Theses", description: "Chapters and front matter.", license: "MIT", visibility: "public", status: "published", organizationId: null, version: 1 },
  ];
  const calls = [];
  const subscribers = new Set();
  const operations = new Map();
  let failure = null;
  let tagPages = 0;
  const dto = project => ProjectSchema.parse(Object.fromEntries(Object.entries(project).filter(([key]) => !["ownerName", "tagIds", "role", "state"].includes(key))));
  function output(name, input) {
    const { params, query, body } = input;
    const project = projects.find(item => item.id === params.p);
    switch (name) {
      case "projectList": {
        const filtered = projects.filter(item => item.state === query.state && (query.owner === "all" || (query.owner === "me" ? item.role === "owner" : item.role !== "owner")) && (!query.tag || item.tagIds.includes(query.tag)) && `${item.name} ${item.ownerName}`.toLowerCase().includes((query.q ?? "").toLowerCase()));
        const key = { title: "name", owner: "ownerName", updated: "updatedAt" }[query.sort];
        filtered.sort((a, b) => (a[key].localeCompare(b[key]) || a.id.localeCompare(b.id)) * (query.direction === "asc" ? 1 : -1));
        return { items: filtered.map(({ state: ignored, ...item }) => { void ignored; return item; }), nextCursor: null };
      }
      case "tagsList": tagPages++; return { items: tags, nextCursor: null };
      case "templatesList": return { items: templates, nextCursor: null };
      case "organizationsList": return { items: [], nextCursor: null };
      case "connectionsList": return { items: [], nextCursor: null };
      case "environmentsList": return [{ id: ids.environment, label: "TeX Live 2025", release: "2025", backend: "bwrap", rootOrImageDigest: "fixture", engines: ["pdflatex", "xelatex", "lualatex", "latex"], helpers: [], packagesDigest: "a".repeat(64), experimental: false, available: true, probeAt: "2026-10-26T10:00:00Z" }];
      case "projectCreate": {
        const item = { ...make(body.name), ownerName: "You", tagIds: [], role: "owner", state: "active" };
        projects.push(item); return dto(item);
      }
      case "projectGet": assert.ok(project); return dto(project);
      case "projectPatch":
        assert.equal(body.expectedVersion, project.version);
        Object.assign(project, body.name ? { name: body.name } : { settings: body.settings }, { version: project.version + 1 });
        return dto(project);
      case "projectCopy": {
        assert.equal(body.expectedVersion, project.version);
        const copied = { ...make(body.name), ownerName: "You", tagIds: [], role: "owner", state: "active" };
        projects.push(copied); return dto(copied);
      }
      case "projectBulk": {
        for (const item of body.items) assert.equal(item.expectedVersion, projects.find(row => row.id === item.id).version);
        for (const item of body.items) {
          const row = projects.find(candidate => candidate.id === item.id);
          if (body.action !== "download") { row.state = { archive: "archived", trash: "trash", restore: "active" }[body.action]; row.version++; }
        }
        const operation = { id: crypto.randomUUID(), kind: body.action, status: "succeeded", progress: 1, result: null, errorCode: null };
        operations.set(operation.id, operation); return operation;
      }
      case "projectTags":
        assert.equal(input.headers["if-match"], `"v${project.version}"`);
        assert.equal(body.expectedVersion, project.version);
        project.tagIds = body.tagIds; project.version++;
        return { ok: true, version: project.version };
      case "projectDelete":
        assert.equal(body.confirmation, project.name);
        assert.equal(body.expectedVersion, project.version);
        projects.splice(projects.indexOf(project), 1);
        return { ok: true, version: project.version + 1 };
      case "projectLeave":
        assert.notEqual(project.role, "owner");
        projects.splice(projects.indexOf(project), 1);
        return { ok: true, version: project.version + 1 };
      case "tagCreate": {
        const tag = { ...body, id: crypto.randomUUID(), version: 1 };
        tags.push(tag); return tag;
      }
      case "tagGet": return tags.find(item => item.id === params.id);
      case "tagPatch": {
        const tag = tags.find(item => item.id === params.id);
        assert.equal(body.expectedVersion, tag.version);
        Object.assign(tag, { name: body.name, colorHex: body.colorHex, version: tag.version + 1 }); return tag;
      }
      case "tagDelete": {
        const index = tags.findIndex(item => item.id === params.id);
        tags.splice(index, 1); return { ok: true, version: body.expectedVersion + 1 };
      }
      case "operationGet": return operations.get(params.id);
      case "operationDownload": return zipSync({});
      default: throw new Error(`No fixture for ${name}`);
    }
  }
  return {
    calls, projects, tags, get tagPages() { return tagPages; },
    whenCalled(name) {
      return new Promise((resolve, reject) => {
        const listener = call => { if (call.name === name) { clearTimeout(deadline); subscribers.delete(listener); resolve(call); } };
        const deadline = setTimeout(() => { subscribers.delete(listener); reject(new Error(`No HTTP call: ${name}`)); }, 8000);
        subscribers.add(listener);
      });
    },
    failNext(name, code = "CONFLICT", message = "Resource changed. Refresh and retry.") { failure = { name, code, message }; },
    async handle(request) {
      const url = new URL(request.url);
      const match = Object.entries(endpoints).map(([name, route]) => {
        const keys = [...route.path.matchAll(/:([a-z]+)/g)].map(item => item[1]);
        const pathMatch = url.pathname.match(new RegExp("^" + route.path.replace(/:[a-z]+/g, "([^/]+)") + "$"));
        return pathMatch && route.method === request.method ? { name, route, params: Object.fromEntries(keys.map((key, index) => [key, pathMatch[index + 1]])) } : null;
      }).find(Boolean);
      assert.ok(match, `${request.method} ${url.pathname}`);
      const { name, route, params } = match;
      const body = request.method === "GET" ? undefined : request.headers.get("content-type")?.includes("multipart") ? await request.formData() : await request.json();
      const input = route.input.parse({ params, query: Object.fromEntries(url.searchParams), body, headers: Object.fromEntries(request.headers) });
      if (request.method !== "GET") assert.equal(request.headers.get("x-csrf-token"), "projects-fixture-csrf");
      if (route.idempotent) assert.ok(request.headers.get("idempotency-key"));
      const call = { name, input };
      calls.push(call);
      for (const listener of subscribers) listener(call);
      const fail = failure?.name === name ? failure : name === "importCreate" ? { code: "PROVIDER_UNCONFIGURED", message: "Import provider is not configured by the operator." } : null;
      if (fail) {
        failure = null;
        return Response.json({ error: { code: fail.code, message: fail.message }, requestId: crypto.randomUUID() }, { status: 409 });
      }
      const data = route.output.parse(output(name, input));
      if (data instanceof Uint8Array) return new Response(data, { headers: { "x-request-id": crypto.randomUUID(), "content-type": "application/zip" } });
      return Response.json({ data, requestId: crypto.randomUUID() }, { status: route.successStatus, headers: data.version === undefined ? {} : { etag: `"v${data.version}"` } });
    },
  };
}
