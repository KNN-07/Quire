import { z } from "zod";
import { connectControl, connectControlledRole } from "../../../services/operations/installation/controller-server";
import { serveReleaseRole, serveStorageHelper } from "../../../services/operations/installation/prepared-storage-host";
import { rejects } from "node:assert/strict";
import { dirname, join } from "node:path";

const socket = z.string().parse(process.argv[2]);
const session = await connectControlledRole(socket);
await rejects(session.channel.request("ready", { token: "0".repeat(64) }), { code: "CONTROL_LAUNCH_DENIED" });
await rejects(session.channel.request("launch", { binding: session.permit.binding, generation: -1 }));
if (session.permit.execution.purpose !== "ordinary" && session.permit.execution.purpose !== "prepared") {
  const data = session.permit.binding.data;
  if (session.permit.execution.purpose === "backup" && data.dialect === "sqlite" &&
      await Bun.file(join(data.dataRoot, "pause-helper")).exists()) {
    const barrier = await connectControl(join(dirname(socket), "harness.sock"));
    await barrier.request("helper-ready", { execution: session.permit.execution });
    await barrier.closed;
  }
  await serveStorageHelper(session);
} else {
  await serveReleaseRole(session);
}
