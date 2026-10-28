import { test, expect } from "bun:test";
import { IdSchema } from "@quire/contracts";
import { parseCommand, clientSchema } from "../../../services/operations/ssh";

test("parses the Git service and opaque project when the command is canonical", () => {
  // Given: Git's remote command, with a single repository argument.
  const projectId = IdSchema.parse("730d1f5a-4c9a-43e7-8c77-a336963d63bc");
  // When: parsing the forced command.
  const result = parseCommand(`git-upload-pack '/${projectId}.git'`);
  // Then: only the service and project, not a filesystem path, cross the boundary.
  expect(result).toEqual({ projectId, service: "git-upload-pack" });
});

test.each([
  "", "sh", "id", "git-upload-pack '/etc/passwd'", "git-receive-pack '../repo.git'",
  "git-upload-pack '730d1f5a-4c9a-43e7-8c77-a336963d63bc.git'; id",
  "git-upload-pack --strict '730d1f5a-4c9a-43e7-8c77-a336963d63bc.git'",
  "git-upload-pack '730d1f5a-4c9a-43e7-8c77-a336963d63bc.git'\n",
  "git-upload-pack $(id)", "git-upload-archive '730d1f5a-4c9a-43e7-8c77-a336963d63bc.git'",
])("denies shell or path syntax when the command is %j", command => {
  // Given / When: a noncanonical SSH original command reaches the parser.
  const parse = () => parseCommand(command);
  // Then: no command can be dispatched.
  expect(parse).toThrow();
});

test("rejects a remote broker when the endpoint would expose its authority", () => {
  // Given: a nonloopback broker and a syntactically valid shared secret.
  const config = { url: "http://192.0.2.1/", token: "a".repeat(64) };
  // When: parsing the connection boundary.
  const parsed = clientSchema.safeParse(config);
  // Then: the forced command cannot forward private broker authority remotely.
  expect(parsed.success).toBe(false);
});
