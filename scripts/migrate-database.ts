import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import pg from "pg";

import {
  getMigrationStatus,
  loadMigrationFiles,
  migrate,
  type MigrationPool,
} from "../src/server/database/migrations";
import { getRuntimeConfig } from "../src/server/runtimeConfig";

const envArgument = process.argv.find((argument) => argument.startsWith("--env="));
const envFile = envArgument?.slice("--env=".length);
dotenv.config(envFile ? { path: envFile } : undefined);

const config = getRuntimeConfig();
if (config.databaseType !== "postgres") {
  throw new Error("Database migrations require DATABASE_TYPE=postgres.");
}

const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../database/migrations",
);
const files = await loadMigrationFiles(migrationsDirectory);
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
});

try {
  if (process.argv.includes("--status")) {
    const status = await getMigrationStatus(pool as unknown as MigrationPool, files);
    for (const migration of status) {
      console.log(`${migration.applied ? "applied" : "pending"}\t${migration.filename}`);
    }
    if (status.length === 0) console.log("No migration files found.");
  } else {
    await migrate(pool as unknown as MigrationPool, files);
    const status = await getMigrationStatus(pool as unknown as MigrationPool, files);
    console.log(`Database migrations complete: ${status.filter((migration) => migration.applied).length}/${status.length} applied.`);
  }
} finally {
  await pool.end();
}
