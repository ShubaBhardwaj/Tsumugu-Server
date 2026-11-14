import express from "express";
import dotenv from "dotenv";
import { auth } from "./lib/auth.js";
import { toNodeHandler } from "better-auth/node";

dotenv.config();
const app = express();

app.all("/api/auth/{*any}", toNodeHandler(auth));

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello, World!");
});

app.listen(process.env.PORT || 8080, () => {
  console.log("Server is running on http://localhost:8080");
});
