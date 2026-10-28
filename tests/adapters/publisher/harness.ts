import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRuntime,
  loadConfig,
} from "@quire/runtime";
import type { Runtime } from "@quire/runtime";
import {
  register as identity,
  migrations as identityMigrations,
} from "../../../services/accounts/identity";
import {
  CoreProjects,
  readZip,
  register as core,
  migrations as coreMigrations,
} from "../../../services/core/base";
import {
  register as compiler,
  migrations as compilerMigrations,
  startWorker,
  stopWorker,
} from "../../../services/compiler";
import { createAdapterModules, SafeHttpClient } from "../../../services/adapters/shared";
import { createInterchangeModule } from "../../../services/adapters/interchange";
import {
  publisherContribution,
  publisherModule,
} from "../../../services/adapters/publisher";
import { seed } from "../../../scripts/seed";
import { publisherProvider } from "./provider";
import { createPublisherApi } from "./api";
import type { Session } from "./api";
export type { Session } from "./api";

const fixturePassword = "publisher-fixture-password-2026";
const fixtureOrigin = "http://localhost:5173";

export async function publisherFixture() {
  const root = await mkdtemp(join(tmpdir(), "quire-publisher-"));
  const provider = publisherProvider();
  const http = new SafeHttpClient({ fixtureOrigins: [provider.origin] });
  const adapters = createAdapterModules({
    contributions: [publisherContribution],
    http,
  });
  const interchange = createInterchangeModule();
  let runtime: Runtime;
  try {
    runtime = await createRuntime(loadConfig({
      QUIRE_DATA_DIR: root,
      QUIRE_PUBLIC_URL: fixtureOrigin,
    }), {
      modules: [
        {
          id: "010-a-identity",
          lane: "A",
          order: 10,
          register: identity,
          migrations: identityMigrations,
        },
        {
          id: "021-k-base",
          lane: "K",
          order: 21,
          register: core,
          migrations: coreMigrations,
        },
        {
          id: "030-c-compiler",
          lane: "C",
          order: 30,
          register: compiler,
          migrations: compilerMigrations,
        },
        adapters.connections,
        adapters.providers,
        interchange.module,
        publisherModule,
      ],
    });
    await seed(runtime, fixturePassword);
  } catch (error) {
    await interchange.close();
    await adapters.close();
    await provider[Symbol.asyncDispose]();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  const api = createPublisherApi(runtime, provider);
  async function createCompiledProject(owner: Session) {
    const projects = new CoreProjects({
      ...runtime,
      routes: runtime.routes.forLane("X"),
    });
    const project = await projects.createFromFiles(owner.user.id, {
      name: "Publisher submission",
      entries: [
        {
          path: "main.tex",
          bytes: new TextEncoder().encode(
            "\\documentclass{article}\n\\begin{document}\nPublisher fixture.\n\\end{document}\n",
          ),
        },
        {
          path: "source.bin",
          bytes: new Uint8Array([0, 255, 37, 81]),
        },
      ],
    });
    const scope = { projectId: project.id, branch: project.defaultBranch };
    const terminal = Promise.withResolvers<void>();
    const timeout = setTimeout(
      () => terminal.reject(new TypeError("Publisher compile timed out")),
      180_000,
    );
    const unsubscribe = runtime.events.subscribe((event) => {
      if (
        event.topic === "job.changed" &&
        event.payload.status !== "queued" &&
        event.payload.status !== "running"
      ) {
        clearTimeout(timeout);
        unsubscribe();
        terminal.resolve();
      }
    });
    const job = await runtime.services.get("compiler").enqueue(
      owner.user.id,
      {
        scope,
        expectedRevision: (await projects.getBranch(scope)).revision,
        settings: project.settings,
        clean: true,
      },
      "publisher-fixture-compile",
    );
    await startWorker(runtime);
    await terminal.promise;
    const complete = await runtime.services.get("compiler").get(owner.user.id, job.id);
    if (complete.status !== "succeeded") {
      throw new TypeError(`Publisher fixture compile failed: ${complete.failureCode ?? "unknown"}`);
    }
    return project;
  }
  async function retain(name: string, bytes: Uint8Array) {
    const evidence = Bun.env["QUIRE_PUBLISHER_EVIDENCE"];
    if (!evidence) return;
    await mkdir(evidence, { recursive: true });
    await Bun.write(join(evidence, name), bytes);
  }
  return {
    root,
    provider,
    ...api,
    createCompiledProject,
    retain,
    readZip,
    get runtime() {
      return runtime;
    },
    async [Symbol.asyncDispose]() {
      await api.close();
      await stopWorker(runtime);
      await interchange.close();
      await adapters.close();
      await runtime.close();
      await provider[Symbol.asyncDispose]();
      await rm(root, { recursive: true, force: true });
    },
  };
}
export type PublisherFixture = Awaited<ReturnType<typeof publisherFixture>>;
