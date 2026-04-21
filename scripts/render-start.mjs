import { mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const renderDiskPath = process.env.RENDER_DISK_PATH || "/var/data";
const sqliteDbPath =
  process.env.SQLITE_DB_PATH ||
  path.join(renderDiskPath, "macron-pos", "prisma", "dev.sqlite");

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${sqliteDbPath}`;
}

mkdirSync(path.dirname(sqliteDbPath), { recursive: true });

for (const cmd of [["npm", "run", "setup"], ["npm", "run", "start"]]) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
