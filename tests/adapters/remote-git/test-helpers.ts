import { z } from "zod";
import { OperationSchema } from "@quire/contracts";
import type { Id } from "@quire/contracts";
import type { remoteGitHarness } from "./harness";

type Harness = Awaited<ReturnType<typeof remoteGitHarness>>;
type Session = Awaited<ReturnType<Harness["login"]>>;
const envelope = z.object({ data: OperationSchema });

export async function operation(response: Response) {
  const body = await response.json();
  if (response.status !== 202) {
    throw new TypeError(`Expected operation, received ${response.status}: ${JSON.stringify(body)}`);
  }
  return envelope.parse(body).data;
}

export async function action(input: {
  readonly app: Harness;
  readonly session: Session;
  readonly grantId: Id;
  readonly grantVersion: number;
  readonly name: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly projectId?: Id;
  readonly expectedCursor?: string | null;
  readonly key?: string;
}) {
  return input.app.request(`/api/connections/${input.grantId}/actions`, {
    method: "POST",
    headers: {
      ...input.session.headers,
      "idempotency-key": input.key ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      action: input.name,
      parameters: input.parameters,
      expectedVersion: input.grantVersion,
      expectedCursor: input.expectedCursor ?? null,
      ...(input.projectId ? { projectId: input.projectId } : {}),
    }),
  });
}

export async function importProject(input: {
  readonly app: Harness;
  readonly session: Session;
  readonly grantId: Id;
  readonly origin: string;
  readonly key?: string;
}) {
  return input.app.request("/api/imports", {
    method: "POST",
    headers: {
      ...input.session.headers,
      "idempotency-key": input.key ?? crypto.randomUUID(),
    },
    body: JSON.stringify({
      kind: "github",
      name: "Imported remote project",
      source: {
        kind: "git",
        url: `${input.origin}/owner/research.git`,
        branch: "main",
        grantId: input.grantId,
      },
    }),
  });
}
