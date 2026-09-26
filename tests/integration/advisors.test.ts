import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "../support/test-db";

/**
 * Supabase advisor lints re-checked against the real migration chain (PGlite), so regressions
 * fail CI: RLS everywhere, pinned function search_path, one permissive policy per table+command,
 * and an index for every foreign key.
 */
let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
});
afterAll(async () => db.stop());

const rows = <T>(sql: string) => db.prisma.$queryRawUnsafe<T[]>(sql);

describe("database advisor lints", () => {
  it("[security] RLS is enabled on every public table", async () => {
    const off = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity AND c.relname <> '_prisma_migrations'`,
    );
    expect(off).toEqual([]);
  });

  it("[security] every project function pins its search_path", async () => {
    const mutable = await rows<{ proname: string }>(
      `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) cfg WHERE cfg LIKE 'search_path=%')`,
    );
    expect(mutable).toEqual([]);
  });

  it("[performance] at most one permissive policy per table and command", async () => {
    const multi = await rows<{ tablename: string; cmd: string }>(
      `SELECT tablename, cmd FROM (SELECT tablename, unnest(CASE WHEN cmd='ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[cmd] END) cmd FROM pg_policies WHERE schemaname='public' AND permissive='PERMISSIVE') x GROUP BY 1,2 HAVING count(*)>1`,
    );
    expect(multi).toEqual([]);
  });

  it("[performance] every foreign key has a covering index", async () => {
    const missing = await rows<{ tbl: string; fk: string }>(`
      SELECT cl.relname tbl, con.conname fk FROM pg_constraint con
      JOIN pg_class cl ON cl.oid=con.conrelid JOIN pg_namespace n ON n.oid=cl.relnamespace
      WHERE con.contype='f' AND n.nspname='public' AND NOT EXISTS (
        SELECT 1 FROM pg_index i WHERE i.indrelid=con.conrelid AND (i.indkey::int2[])[0:array_length(con.conkey,1)-1] = con.conkey::int2[])`);
    expect(missing).toEqual([]);
  });

  it("[security] policies call app_current_user_id() through an init-plan (SELECT …)", async () => {
    const perRow = await rows<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE schemaname='public' AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'app_current_user_id\\(\\)' AND NOT (coalesce(qual,'')||coalesce(with_check,'')) ~* 'SELECT app_current_user_id'`,
    );
    expect(perRow).toEqual([]);
  });
});
