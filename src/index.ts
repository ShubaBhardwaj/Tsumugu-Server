import "dotenv/config";
import { createApp } from "./app.js";
import { readServerConfig } from "./lib/config.js";
import { reconcileLegacyJobs } from "./services/job-recovery.services.js";

const config = readServerConfig();

createApp().listen(config.port, () => {
  console.log(`Server is running on port ${config.port}`);

  void reconcileLegacyJobs().catch(() =>
    console.error(
      "Startup recovery failed; run jobs:recover after checking database migrations",
    ),
  );
});
