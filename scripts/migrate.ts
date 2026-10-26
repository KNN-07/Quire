import { createApplication } from "../apps/server/src/composition";

const app = await createApplication();
try {
  console.info("db.migrated", { dataDir: app.runtime.config.dataDir });
} finally { app.close(); }
