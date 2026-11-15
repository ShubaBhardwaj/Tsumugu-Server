import express from "express";
import cors from "cors";
import { toNodeHandler } from "better-auth/node";
import { serve } from "inngest/express";
import { auth } from "./lib/auth.js";
import { readServerConfig } from "./lib/config.js";
import { inngest } from "./inngest/client.js";
import { functions } from "./inngest/index.js";
import { registerRoutes } from "./routes/index.js";
import { errorHandler } from "./middleware/error-handler.middleware.js";

export function createApp() {
  const config = readServerConfig();
  const app = express();

  app.use(
    cors({
      origin: config.clientUrl,
      credentials: true,
      exposedHeaders: ["X-Conversation-Id"],
    }),
  );

  app.all("/api/auth/{*any}", toNodeHandler(auth));

  app.use(express.json({ limit: "256kb" }));

  app.use("/api/inngest", serve({ client: inngest, functions }));

  app.get("/", (_req, res) => {
    res.json({ status: "ok" });
  });

  registerRoutes(app);

  app.use(errorHandler);

  return app;
}
