import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdSchema } from "@quire/contracts";
import { prepareInstallationWorker } from "../../../apps/server/src/installation-role";
import { assertUncontrolledEntrypoint } from "../../../services/operations/installation/launch";
import { controlFixture } from "../../operations/installation/control-fixture";

test("direct worker execution factory cannot manufacture an installed session", async () => {
  await using fixture = await controlFixture();
  const failure = await prepareInstallationWorker(fixture.prior, {
    kind: "worker", workerId: IdSchema.parse(crypto.randomUUID()), environmentIds: [IdSchema.parse(crypto.randomUUID())],
  }).then(() => null, (error: unknown) => error);
  expect(failure).toMatchObject({ code: "CONTROL_LAUNCH_REQUIRED" });
  expect(await Bun.file(join(fixture.root, "data/prior/quire.sqlite")).exists()).toBe(false);
});

test("a nested generation source cannot become uncontrolled by overriding its data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-installation-nested-"));
  try {
    await writeFile(join(root, ".quire-installation.json"), '{"installationId":"nested-source-proof"}', { mode: 0o400 });
    const failure = await assertUncontrolledEntrypoint({ QUIRE_DATA_DIR: join(root, "work/nested") })
      .then(() => null, (error: unknown) => error);
    expect(failure).toMatchObject({ code: "CONTROL_LAUNCH_REQUIRED" });
    expect(await Bun.file(join(root, "work/nested/quire.sqlite")).exists()).toBe(false);
  } finally { await rm(root, { recursive: true }); }
});
