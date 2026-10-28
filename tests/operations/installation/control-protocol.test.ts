import { expect, test } from "bun:test";
import { AuthenticatedControlCommand, signControlCommand } from "../../../services/operations/installation/protocol";
import type { ControlCredential } from "../../../services/operations/installation/protocol";
import { at, controlFixture, id, later } from "./control-fixture";

test("authenticated commands bind complete request, credential, installation and time", async () => {
  await using fixture = await controlFixture();
  const credential: ControlCredential = {
    id: id(), installationId: "fixture-install", channel: "api",
    secret: crypto.getRandomValues(new Uint8Array(32)),
  };
  const envelope = signControlCommand({
    protocolVersion: 1, installationId: credential.installationId,
    credentialId: credential.id, requestId: id(), issuedAt: at,
    command: { method: "submit", input: fixture.command() },
  }, credential);
  expect(AuthenticatedControlCommand.authenticate(envelope, credential, at).channel).toBe("api");
  expect(() => AuthenticatedControlCommand.authenticate(envelope, credential, later)).toThrow("CONTROL_UNAUTHENTICATED");
  expect(() => AuthenticatedControlCommand.authenticate({ ...envelope, installationId: "other" }, credential, at)).toThrow("CONTROL_UNAUTHENTICATED");
  expect(() => AuthenticatedControlCommand.authenticate({ ...envelope, requestId: id() }, credential, at)).toThrow("CONTROL_UNAUTHENTICATED");
  expect(() => AuthenticatedControlCommand.authenticate(envelope, { ...credential, secret: new Uint8Array(32) }, at)).toThrow("CONTROL_UNAUTHENTICATED");
  const changed = { ...envelope, command: { method: "submit", input: { ...fixture.command(), key: "tampered" } } };
  expect(() => AuthenticatedControlCommand.authenticate(changed, credential, at)).toThrow("CONTROL_UNAUTHENTICATED");
});

test("API credentials cannot recover; exact operator recovery is installation scoped", async () => {
  await using fixture = await controlFixture();
  const credential: ControlCredential = {
    id: id(), installationId: "fixture-install", channel: "api",
    secret: crypto.getRandomValues(new Uint8Array(32)),
  };
  const input = {
    protocolVersion: 1, installationId: credential.installationId,
    credentialId: credential.id, requestId: id(), issuedAt: at,
    command: { method: "recover", input: {
      installationId: "fixture-install", operationId: id(), generation: 1, supervisorEpoch: fixture.epoch,
    } },
  };
  const envelope = signControlCommand({ ...input, protocolVersion: 1,
    command: { ...input.command, method: "recover" } }, credential);
  expect(() => AuthenticatedControlCommand.authenticate(envelope, credential, at)).toThrow("CONTROL_FORBIDDEN");
  const operator: ControlCredential = { ...credential, channel: "operator" };
  expect(AuthenticatedControlCommand.authenticate(envelope, operator, at).channel).toBe("operator");
  const wrongInstall = signControlCommand({
    protocolVersion: 1, installationId: credential.installationId,
    credentialId: credential.id, requestId: id(), issuedAt: at,
    command: { method: "recover", input: { ...input.command.input, installationId: "other" } },
  }, operator);
  expect(() => AuthenticatedControlCommand.authenticate(wrongInstall, operator, at)).toThrow("CONTROL_FORBIDDEN");
});
