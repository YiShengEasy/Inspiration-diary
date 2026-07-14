import pg from "pg";

const databaseUrl = process.env.KNOWLEDGE_BENCHMARK_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("KNOWLEDGE_BENCHMARK_DATABASE_URL is required; the normal application database is never selected implicitly.");

const nodeCount = Math.max(1_000, Number.parseInt(process.env.KNOWLEDGE_BENCHMARK_NODES || "100000", 10));
const membershipCount = Math.max(nodeCount, Number.parseInt(process.env.KNOWLEDGE_BENCHMARK_MEMBERSHIPS || "1000000", 10));
const linkCount = Math.max(nodeCount, Number.parseInt(process.env.KNOWLEDGE_BENCHMARK_LINKS || "1000000", 10));
const folderCount = Math.max(10, Math.min(10_000, Math.ceil(nodeCount / 100)));
const userId = "00000000-0000-4000-8000-000000000001";
const pool = new pg.Pool({ connectionString: databaseUrl, ssl: false, max: 1 });
const client = await pool.connect();

async function explain(label: string, sql: string, values: unknown[]) {
  const result = await client.query<{ "QUERY PLAN": string }>(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${sql}`, values);
  const plan = result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  const execution = plan.match(/Execution Time: ([0-9.]+) ms/u)?.[1] ?? "unknown";
  console.log(`${label}\t${execution} ms`);
}

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TEMP TABLE bench_folders (
      user_id uuid NOT NULL, id uuid NOT NULL, parent_id uuid, sort_order bigint NOT NULL,
      PRIMARY KEY (user_id, id)
    ) ON COMMIT DROP;
    CREATE TEMP TABLE bench_nodes (
      user_id uuid NOT NULL, id uuid NOT NULL, updated_at bigint NOT NULL, active boolean NOT NULL,
      PRIMARY KEY (user_id, id)
    ) ON COMMIT DROP;
    CREATE TEMP TABLE bench_memberships (
      user_id uuid NOT NULL, folder_id uuid NOT NULL, node_id uuid NOT NULL, sort_order bigint NOT NULL,
      PRIMARY KEY (user_id, folder_id, node_id)
    ) ON COMMIT DROP;
    CREATE TEMP TABLE bench_links (
      user_id uuid NOT NULL, source_node_id uuid NOT NULL, target_node_id uuid NOT NULL
    ) ON COMMIT DROP;
  `);
  await client.query(
    `INSERT INTO bench_folders
     SELECT $1::uuid, md5('f' || value)::uuid,
            CASE WHEN value <= 10 THEN NULL ELSE md5('f' || ((value % 10) + 1))::uuid END,
            value
     FROM generate_series(1, $2::int) value`,
    [userId, folderCount],
  );
  await client.query(
    `INSERT INTO bench_nodes
     SELECT $1::uuid, md5('n' || value)::uuid, 2000000000000 - value, TRUE
     FROM generate_series(1, $2::int) value`,
    [userId, nodeCount],
  );
  await client.query(
    `INSERT INTO bench_memberships
     SELECT $1::uuid,
            md5('f' || ((value % $3::int) + 1))::uuid,
            md5('n' || ((value % $4::int) + 1))::uuid,
            value
     FROM generate_series(1, $2::int) value
     ON CONFLICT DO NOTHING`,
    [userId, membershipCount, folderCount, nodeCount],
  );
  await client.query(
    `INSERT INTO bench_links
     SELECT $1::uuid,
            md5('n' || ((value % $3::int) + 1))::uuid,
            md5('n' || (((value + 37) % $3::int) + 1))::uuid
     FROM generate_series(1, $2::int) value`,
    [userId, linkCount, nodeCount],
  );
  await client.query("CREATE INDEX bench_folders_parent_idx ON bench_folders(user_id, parent_id, sort_order, id)");
  await client.query("CREATE INDEX bench_memberships_folder_idx ON bench_memberships(user_id, folder_id, sort_order, node_id)");
  await client.query("CREATE INDEX bench_memberships_node_idx ON bench_memberships(user_id, node_id, folder_id)");
  await client.query("CREATE INDEX bench_nodes_updated_idx ON bench_nodes(user_id, active, updated_at DESC, id)");
  await client.query("CREATE INDEX bench_links_source_idx ON bench_links(user_id, source_node_id)");
  await client.query("CREATE INDEX bench_links_target_idx ON bench_links(user_id, target_node_id)");
  await client.query("ANALYZE bench_folders; ANALYZE bench_nodes; ANALYZE bench_memberships; ANALYZE bench_links;");

  await explain("child-folders", "SELECT id FROM bench_folders WHERE user_id=$1 AND parent_id IS NULL ORDER BY sort_order,id LIMIT 100", [userId]);
  await explain(
    "folder-page",
    `SELECT node.id FROM bench_memberships membership
     JOIN bench_nodes node ON node.user_id=membership.user_id AND node.id=membership.node_id
     WHERE membership.user_id=$1 AND membership.folder_id=md5('f1')::uuid AND node.active=TRUE
     ORDER BY node.updated_at DESC,node.id LIMIT 30`,
    [userId],
  );
  await explain(
    "unfiled-page",
    `SELECT node.id FROM bench_nodes node
     WHERE node.user_id=$1 AND node.active=TRUE AND NOT EXISTS (
       SELECT 1 FROM bench_memberships membership WHERE membership.user_id=node.user_id AND membership.node_id=node.id
     ) ORDER BY node.updated_at DESC,node.id LIMIT 30`,
    [userId],
  );
  await explain(
    "one-hop-graph",
    `SELECT CASE WHEN source_node_id=$2::uuid THEN target_node_id ELSE source_node_id END
     FROM bench_links WHERE user_id=$1 AND (source_node_id=$2::uuid OR target_node_id=$2::uuid) LIMIT 100`,
    [userId, "cfcd2084-95d5-35ef-a6e7-dff9f98764da"],
  );
  console.log(JSON.stringify({ nodeCount, folderCount, membershipCount, linkCount }));
} finally {
  await client.query("ROLLBACK").catch(() => undefined);
  client.release();
  await pool.end();
}
