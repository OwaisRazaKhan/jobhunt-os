import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { uuidv7 } from "@/lib/ids";
import { setDbForTests } from "@/server/db";
import { MemoryObjectStorage, setStorageForTests } from "@/server/storage";

/**
 * Disposable Postgres for integration tests: PGlite (real Postgres compiled to
 * WASM) running in-process, exposed over the Postgres wire protocol so the app's
 * normal Prisma + pg driver path is exercised. The real migration SQL (including
 * RLS policies and roles) is applied, so isolation tests hit the real policies.
 */
export interface TestDb {
  prisma: PrismaClient;
  storage: MemoryObjectStorage;
  pg: PGlite;
  stop: () => Promise<void>;
}

function migrationSql(): string {
  const dir = path.resolve(process.cwd(), "prisma/migrations");
  return readdirSync(dir)
    .filter((name) => !name.endsWith(".toml"))
    .sort()
    .map((name) => readFileSync(path.join(dir, name, "migration.sql"), "utf8"))
    .join("\n");
}

export async function startTestDb(): Promise<TestDb> {
  const pg = await PGlite.create();
  await pg.exec(migrationSql());
  const port = 40000 + Math.floor(Math.random() * 20000);
  const server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1", maxConnections: 4 });
  await server.start();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`,
      max: 1,
    }),
  });
  const storage = new MemoryObjectStorage();
  setDbForTests(prisma);
  setStorageForTests(storage);
  return {
    prisma,
    storage,
    pg,
    stop: async () => {
      await prisma.$disconnect();
      await server.stop();
      await pg.close();
      setDbForTests(undefined);
      setStorageForTests(undefined);
    },
  };
}

/** Create a clearly synthetic test user directly (owner connection). */
export async function createTestUser(prisma: PrismaClient, label = "Test Candidate") {
  const id = uuidv7();
  await prisma.user.create({
    data: {
      id,
      name: label,
      email: `${label.toLowerCase().replace(/\s+/g, ".")}.${id.slice(-8)}@example.test`,
    },
  });
  return { userId: id };
}
