// Run in its own Bun test process: module substitutions coordinate the boundary,
// while supervisor-execution/pandoc.test.ts proves the real installed transport.
import { afterAll, expect, mock, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlError } from "../../../services/operations/installation/model";

const root = await mkdtemp(join(tmpdir(), "quire-pandoc-lifecycle-"));
const image = `sha256:${"a".repeat(64)}`;
let denied = false;
let calls = 0;
let entered = Promise.withResolvers<void>();
let release = Promise.withResolvers<void>();
let aborted = Promise.withResolvers<void>();
let block: "pandoc-probe" | "document-convert" = "pandoc-probe";
const profile = { id: "pandoc", image, kinds: ["pandoc-probe", "document-convert"] };
await mock.module("../../../services/operations/installation/launch", () => ({
  installationRoleSession: () => ({ permit: { binding: { data: { dialect: "sqlite", dataRoot: root } } } }),
}));
await mock.module("../../../services/operations/installation/caller-execution-context", () => ({
  installationExecutionContext: () => {
    if (denied) throw new ControlError("UPDATES_EXECUTION_PROFILE_UNAVAILABLE");
    return Promise.resolve({ profile, profileId: profile.id });
  },
}));
await mock.module("../../../services/operations/installation/caller-execution", () => ({
  installationSandbox: async (input: { signal: AbortSignal; installationWork: { kind: string } }, backend: string, selected: string) => {
    expect(backend).toBe("docker"); expect(selected).toBe(image);
    calls++;
    if (input.installationWork.kind === block) {
      input.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      entered.resolve();
      await release.promise;
      input.signal.throwIfAborted();
    }
    return { code: 0, canceled: false, stdout: new TextEncoder().encode("pandoc fixture\n"), stderr: "" };
  },
}));
const { PandocConverter } = await import("../../../services/adapters/interchange/converter");
const input = { entries: [{ path: "main.md", bytes: new TextEncoder().encode("# fixture") }],
  main: "main.md", from: "markdown", to: "latex" } as const;
function reset(kind: typeof block) {
  block = kind; calls = 0; denied = false;
  entered = Promise.withResolvers<void>(); release = Promise.withResolvers<void>(); aborted = Promise.withResolvers<void>();
}
afterAll(async () => { mock.restore(); await rm(root, { recursive: true, force: true }); });

test("close aborts a standalone probe and awaits its owned teardown before settling", async () => {
  reset("pandoc-probe");
  const converter = new PandocConverter("caller image must not be used");
  const probe = converter.probe().then(() => null, (error: unknown) => error);
  await entered.promise;
  let closed = false;
  const closing = converter.close().then(() => { closed = true; });
  await aborted.promise;
  expect(closed).toBe(false);
  expect((await readdir(join(root, "work"))).length).toBe(1);
  release.resolve();
  expect(await probe).toBeInstanceOf(DOMException);
  await closing;
  expect(await readdir(join(root, "work"))).toEqual([]);
  expect(converter.capability()).toMatchObject({ enabled: false, state: "disabled" });
  expect(await converter.probe().then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONVERSION_CLOSED" });
});
test("conversion cancellation waits for teardown and removes staged source", async () => {
  reset("document-convert");
  const converter = new PandocConverter();
  const controller = new AbortController();
  const work = converter.convert({ ...input, signal: controller.signal }).then(() => null, (error: unknown) => error);
  await entered.promise;
  controller.abort();
  await aborted.promise;
  expect(calls).toBe(2);
  release.resolve();
  expect(await work).toBeInstanceOf(DOMException);
  await converter.close();
  expect(await readdir(join(root, "work"))).toEqual([]);
  expect(await converter.convert(input).then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONVERSION_CLOSED" });
});
test("close during conversion's implicit probe cancels before conversion starts", async () => {
  reset("pandoc-probe");
  const converter = new PandocConverter();
  const work = converter.convert(input).then(() => null, (error: unknown) => error);
  await entered.promise;
  const closing = converter.close();
  await aborted.promise;
  release.resolve();
  expect(await work).toBeInstanceOf(DOMException);
  await closing;
  expect(calls).toBe(1);
  expect(await readdir(join(root, "work"))).toEqual([]);
});
test("pre-aborted and unavailable signed profiles never execute or fall back", async () => {
  reset("pandoc-probe");
  const converter = new PandocConverter(image);
  expect(await converter.convert({ ...input, signal: AbortSignal.abort() }).then(() => null, (error: unknown) => error))
    .toBeInstanceOf(DOMException);
  expect(calls).toBe(0);
  denied = true;
  expect(await converter.probe()).toMatchObject({ state: "unconfigured", enabled: false });
  expect(await converter.convert(input).then(() => null, (error: unknown) => error)).toMatchObject({ code: "CONVERSION_UNCONFIGURED" });
  expect(calls).toBe(0);
  await converter.close();
});
