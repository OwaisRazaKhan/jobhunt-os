/**
 * Local, zero-install Postgres for development and demos (NOT for production).
 * Runs PGlite (Postgres compiled to WASM) with on-disk persistence and exposes
 * it over the Postgres wire protocol, then applies prisma/migrations in order.
 *
 *   npm run db:local                 # listens on 127.0.0.1:54329
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
 *
 * The real backend is Supabase (see docs/setup.md). This exists so the app and
 * its RLS policies can be exercised without any external service.
 */
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const DATA_DIR = path.resolve(process.env.LOCAL_DB_DIR ?? ".data/pglite");
const PORT = Number(process.env.LOCAL_DB_PORT ?? 54329);

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = await PGlite.create(DATA_DIR);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS "_local_migrations" (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
  );
  const migrationsDir = path.resolve("prisma/migrations");
  const applied = new Set(
    (await db.query<{ name: string }>(`SELECT name FROM "_local_migrations"`)).rows.map(
      (r) => r.name,
    ),
  );
  for (const name of readdirSync(migrationsDir)
    .filter((n) => !n.endsWith(".toml"))
    .sort()) {
    if (applied.has(name)) continue;
    await db.exec(readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8"));
    await db.query(`INSERT INTO "_local_migrations" (name) VALUES ($1)`, [name]);
    console.warn(`applied migration ${name}`);
  }
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 8 });
  await server.start();
  console.warn(
    `local Postgres ready: postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres (data: ${DATA_DIR})`,
  );
  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
