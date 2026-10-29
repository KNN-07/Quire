import { expect, test } from "bun:test";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IdSchema, InstantSchema } from "@quire/contracts";
import { AuthenticatedControlCommand, canonicalJson, signControlCommand } from "../../../services/operations/installation/protocol";
import { connectControl, handleControl, listenControl } from "../../../services/operations/installation/controller-server";
import { validateDriverConfig } from "../../../services/operations/installation/driver-config";
import type { ControlCredential } from "../../../services/operations/installation/protocol";
import { rejects } from "node:assert/strict";
import { UpdateError } from "../../../services/operations/updates/model";

test("canonical bounded frames authenticate every command byte and the actual Unix peer", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-supervisor-ipc-"));
  const path = join(root, "control.sock");
  const credential: ControlCredential = { id: IdSchema.parse(crypto.randomUUID()), installationId: "wire-proof",
    channel: "operator", secret: crypto.getRandomValues(new Uint8Array(32)) };
  let calls = 0;
  const server = await listenControl(path, (channel, peer) => {
    handleControl(channel, async (method, input) => {
      expect(peer.pid).toBe(process.pid);
      expect(peer.startTime).toMatch(/^\d+$/);
      if (method !== "control") throw new Error("Unknown method");
      const authenticated = AuthenticatedControlCommand.authenticate(input, credential, InstantSchema.parse(new Date().toISOString()));
      calls++;
      return { method: authenticated.envelope.command.method };
    });
  }, 4096);
  try {
    const envelope = signControlCommand({ protocolVersion: 1, installationId: credential.installationId,
      credentialId: credential.id, requestId: IdSchema.parse(crypto.randomUUID()), issuedAt: InstantSchema.parse(new Date().toISOString()),
      command: { method: "status", input: {} } }, credential);
    const channel = await connectControl(path, 4096);
    try {
      expect(await channel.request("control", envelope)).toEqual({ method: "status" });
      await rejects(channel.request("control", { ...envelope, requestId: crypto.randomUUID() }), { code: "CONTROL_UNAUTHENTICATED" });
      await rejects(channel.request("control", { ...envelope, mac: "0".repeat(64) }), { code: "CONTROL_UNAUTHENTICATED" });
      expect(calls).toBe(1);
    } finally { channel.close(); }
    for (const bytes of [
      " ".repeat(4097),
      " " + canonicalJson({ type: "request", id: crypto.randomUUID(), method: "control", input: envelope }) + "\n",
    ]) {
      const socket = createConnection(path);
      const closed = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Bounded frame was not rejected")), 5000);
        socket.once("close", () => { clearTimeout(timer); resolve(); });
      });
      socket.on("error", () => socket.destroy());
      socket.once("connect", () => socket.write(bytes));
      await closed;
    }
    expect(calls).toBe(1);
  } finally { await server.close(); await rm(root, { recursive: true }); }
});
test("Compose and Helm fail with the explicit unsupported deployment capability", async () => {
  for (const driver of ["compose", "helm"]) await rejects(validateDriverConfig({ driver }), { code: "UPDATES_DEPLOYMENT_UNSUPPORTED" });
});
test("controller transport preserves known update denial codes without exposing unexpected failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "quire-supervisor-error-"));
  const path = join(root, "control.sock");
  const server = await listenControl(path, channel => {
    handleControl(channel, async method => {
      if (method === "replay") throw new UpdateError("REPLAY_OR_DOWNGRADE");
      throw new Error("private internal failure");
    });
  });
  try {
    const channel = await connectControl(path);
    try {
      await rejects(channel.request("replay", {}), { code: "REPLAY_OR_DOWNGRADE" });
      await rejects(channel.request("unexpected", {}), { code: "CONTROL_REQUEST_FAILED" });
    } finally { channel.close(); }
  } finally { await server.close(); await rm(root, { recursive: true }); }
});
