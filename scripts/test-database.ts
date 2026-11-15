import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertTestDatabase } from "../tests/helpers";
import dotenv from "dotenv";
dotenv.config({ path: join(process.cwd(), ".env.test") });

// Uses an isolated cluster, never DATABASE_URL or the developer's existing database.
const bin = process.env.PG_BIN ?? "/opt/homebrew/opt/postgresql@15/bin";
const root = await mkdtemp(join(tmpdir(), "tsumugu-test-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const run = (command: string, args: string[], env = process.env) => {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`);
};
let started = false;
try {
  run(join(bin, "initdb"), [
    "-D",
    join(root, "data"),
    "-A",
    "trust",
    "-U",
    "test",
    "--no-locale",
    "-E",
    "UTF8",
  ]);
  run(join(bin, "pg_ctl"), [
    "-D",
    join(root, "data"),
    "-l",
    join(root, "postgres.log"),
    "-o",
    `-p ${port} -k ${root} -h 127.0.0.1`,
    "-w",
    "start",
  ]);
  started = true;
  run(join(bin, "createdb"), [
    "-h",
    "127.0.0.1",
    "-p",
    String(port),
    "-U",
    "test",
    "tsumugu_test",
  ]);
  const url = assertTestDatabase(
    `postgresql://test@127.0.0.1:${port}/tsumugu_test`,
  );
  run("bun", ["x", "--no-install", "prisma", "migrate", "deploy"], {
    ...process.env,
    DATABASE_URL: url,
  });
  run("bun", ["run", "build"]);
  run(
    "bun",
    [
      "test",
      "--preload",
      "./tests/setup.ts",
      "./tests",
      ...process.argv.slice(2),
    ],
    {
      ...process.env,
      TEST_DATABASE_URL: url,
      DATABASE_URL: url,
    },
  );
} finally {
  if (started)
    run(join(bin, "pg_ctl"), [
      "-D",
      join(root, "data"),
      "-m",
      "fast",
      "-w",
      "stop",
    ]);
  await rm(root, { recursive: true, force: true });
}
