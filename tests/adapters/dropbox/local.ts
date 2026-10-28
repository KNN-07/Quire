import { mutateFiles, emptyFile } from "../../../services/core/base";
import type { dropboxFixture } from "./harness";
import { scope } from "./harness";

export async function localChange(fixture: Awaited<ReturnType<typeof dropboxFixture>>, change: {
  readonly path: string; readonly text: string | null; readonly rename?: string;
}) {
  const service = fixture.fixture.service;
  await mutateFiles(service, { actorId: fixture.owner.user.id, scope,
    expectedVersion: (await service.getBranch(scope)).revision }, async files => {
    const existing = files.find(file => file.path === change.path);
    const retained = files.filter(file => file.path !== change.path).map(file => ({ file }));
    if (change.text === null) return retained;
    return [...retained, { file: { ...(existing ?? emptyFile(change.path, "file")), path: change.rename ?? change.path },
      bytes: new TextEncoder().encode(change.text) }];
  });
}
export async function localText(fixture: Awaited<ReturnType<typeof dropboxFixture>>, path: string) {
  const file = (await fixture.fixture.service.listFiles(scope)).find(entry => entry.path === path);
  return file?.blob ? new TextDecoder().decode(await fixture.fixture.runtime.blobs.get(file.blob)) : null;
}
