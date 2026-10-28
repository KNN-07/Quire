import { parseArgs } from "node:util";
import { createApplication } from "../../apps/server/src/composition";
import { createBackup, verifyBackup, restoreBackup, runScheduledBackup } from "../../services/operations/backups";
import { backupHost } from "../../services/operations/backups/model";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    action: { type: "string", default: "create" }, archive: { type: "string" },
    target: { type: "string" }, confirmation: { type: "string" },
    operator: { type: "string" },
  }, strict: true,
});
const application = await createApplication();
try {
  switch (values.action) {
    case "create":
      console.info(JSON.stringify(await createBackup(application.runtime)));
      break;
    case "verify":
      if (!values.archive) throw new TypeError("--archive is required");
      console.info(JSON.stringify((await verifyBackup(values.archive, application.runtime.secretKey,
        backupHost(application.runtime).signingKey)).manifest));
      break;
    case "restore":
      if (!values.archive || !values.target || !values.confirmation) {
        throw new TypeError("--archive, --target and --confirmation are required");
      }
      console.info(JSON.stringify(await restoreBackup(application.runtime, {
        archive: values.archive, target: values.target, confirmation: values.confirmation,
      })));
      break;
    case "scheduled":
      if (!values.operator) throw new TypeError("--operator must identify an enrolled operator");
      console.info(JSON.stringify(await runScheduledBackup(
        { ...application.runtime, routes: application.runtime.routes.forLane("O") }, values.operator)));
      break;
    default: throw new TypeError("Use --action create|verify|restore|scheduled");
  }
} finally { await application.close(); }
