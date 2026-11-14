import express from "express";
import dotenv from "dotenv";
import { auth } from "./lib/auth.js";
import cors from "cors";
import { errorHandler } from "./middleware/error-handler.middleware.js";
import { toNodeHandler } from "better-auth/node";
import { registerRoutes } from "./routes/index.js";

dotenv.config();
const app = express();
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:3001";

app.use(
  cors({
    origin: clientUrl,
    credentials: true,
  }),
);

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

registerRoutes(app);

app.use(errorHandler);

app.listen(process.env.PORT || 8080, () => {
  console.log("Server is running on http://localhost:8080");
});
