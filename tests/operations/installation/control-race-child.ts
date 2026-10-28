import { z } from "zod";
import { IdSchema } from "@quire/contracts";
import { ControlStore } from "../../../services/operations/installation/control-store";
import { AcceptedReleaseSchema, ReservedUpdateCommandSchema } from "../../../services/operations/installation/model";
import { at } from "./control-fixture";

const [path, epoch, commandBytes, releaseBytes] = process.argv.slice(2);
if (path === undefined || commandBytes === undefined || releaseBytes === undefined) throw new Error("Missing child inputs");
const command = ReservedUpdateCommandSchema.parse(JSON.parse(commandBytes));
const release = AcceptedReleaseSchema.parse(JSON.parse(releaseBytes));
const store = ControlStore.open(path, command.installationId, IdSchema.parse(epoch), at);
process.on("message", input => {
  z.literal("accept").parse(input);
  try {
    const receipt = store.accept(command, release, at);
    process.send?.({ outcome: "accepted", operationId: receipt.command.operationId });
  } catch (error) {
    process.send?.({ outcome: "error", message: error instanceof Error ? error.message : String(error) });
  } finally {
    store.close();
    process.disconnect?.();
  }
});
process.send?.({ outcome: "ready" });
