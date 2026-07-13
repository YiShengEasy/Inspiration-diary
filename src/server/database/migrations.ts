import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const MIGRATION_FILENAME_PATTERN = /^(\d{3,})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const MIGRATION_LOCK_NAME = "inspiration-diary-migrations";

export interface MigrationFile {
  version: string;
  filename: string;
  sql: string;
}

export interface MigrationName {
  version: string;
  filename: string;
}

export interface MigrationQueryResult {
  rows: unknown[];
}

export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<MigrationQueryResult>;
  release(): void;
}

export interface MigrationPool {
  connect(): Promise<MigrationClient>;
}

export interface MigrationStatus extends MigrationName {
  applied: boolean;
}

function compareVersions(left: MigrationName, right: MigrationName): number {
  const leftVersion = BigInt(left.version);
  const rightVersion = BigInt(right.version);
  if (leftVersion < rightVersion) return -1;
  if (leftVersion > rightVersion) return 1;
  return left.filename.localeCompare(right.filename);
}

export function parseMigrationNames(filenames: string[]): MigrationName[] {
  const parsed = filenames.map((filename) => {
    const match = MIGRATION_FILENAME_PATTERN.exec(filename);
    if (!match) {
      throw new Error(
        `Invalid migration filename "${filename}". Expected a lowercase name such as 001_create_table.sql.`,
      );
    }
    return { version: match[1], filename };
  });

  const versions = new Map<string, string>();
  for (const migration of parsed) {
    const previous = versions.get(migration.version);
    if (previous) {
      throw new Error(
        `Duplicate migration version ${migration.version}: "${previous}" and "${migration.filename}".`,
      );
    }
    versions.set(migration.version, migration.filename);
  }

  return parsed.sort(compareVersions);
}

export function selectPending(filenames: string[], appliedVersions: Set<string>): string[] {
  return parseMigrationNames(filenames)
    .filter((migration) => !appliedVersions.has(migration.version))
    .map((migration) => migration.filename);
}

export async function loadMigrationFiles(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = parseMigrationNames(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".sql")).map((entry) => entry.name),
  );

  return Promise.all(
    names.map(async ({ version, filename }) => ({
      version,
      filename,
      sql: await readFile(path.join(directory, filename), "utf8"),
    })),
  );
}

function validateMigrationFiles(files: MigrationFile[]): MigrationFile[] {
  const names = parseMigrationNames(files.map((file) => file.filename));
  const byFilename = new Map(files.map((file) => [file.filename, file]));

  return names.map((name) => {
    const file = byFilename.get(name.filename);
    if (!file || file.version !== name.version) {
      throw new Error(`Migration version does not match filename: ${name.filename}.`);
    }
    if (!file.sql.trim()) throw new Error(`Migration file is empty: ${name.filename}.`);
    return file;
  });
}

async function ensureMigrationTable(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      applied_at BIGINT NOT NULL
    )
  `);
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS filename TEXT");
  await client.query("UPDATE schema_migrations SET filename = version || '_legacy.sql' WHERE filename IS NULL");
  await client.query("ALTER TABLE schema_migrations ALTER COLUMN filename SET NOT NULL");
}

async function readAppliedVersions(client: MigrationClient): Promise<Set<string>> {
  const result = await client.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((row) => (row as { version: string }).version));
}

export async function migrate(pool: MigrationPool, files: MigrationFile[], appliedAt = Date.now()): Promise<void> {
  const orderedFiles = validateMigrationFiles(files);
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query(`SELECT pg_advisory_lock(hashtext('${MIGRATION_LOCK_NAME}'))`);
    locked = true;
    await ensureMigrationTable(client);
    const appliedVersions = await readAppliedVersions(client);

    for (const file of orderedFiles) {
      if (appliedVersions.has(file.version)) continue;

      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query(
          "INSERT INTO schema_migrations(version, filename, applied_at) VALUES ($1, $2, $3)",
          [file.version, file.filename, appliedAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    try {
      if (locked) {
        await client.query(`SELECT pg_advisory_unlock(hashtext('${MIGRATION_LOCK_NAME}'))`);
      }
    } finally {
      client.release();
    }
  }
}

export async function getMigrationStatus(pool: MigrationPool, files: MigrationFile[]): Promise<MigrationStatus[]> {
  const orderedFiles = validateMigrationFiles(files);
  const client = await pool.connect();
  try {
    const tableResult = await client.query(
      "SELECT to_regclass('public.schema_migrations')::text AS table_name",
    );
    const tableName = (tableResult.rows[0] as { table_name: string | null } | undefined)?.table_name;
    const appliedVersions = tableName
      ? await readAppliedVersions(client)
      : new Set<string>();

    return orderedFiles.map(({ version, filename }) => ({
      version,
      filename,
      applied: appliedVersions.has(version),
    }));
  } finally {
    client.release();
  }
}
