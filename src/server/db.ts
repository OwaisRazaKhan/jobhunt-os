import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { getServerEnv } from "@/config/env";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { isUuid } from "@/lib/ids";
import { AppError } from "./errors";

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

/** Postgres role that is subject to RLS. Created by the Phase 1 migration. */
export const APP_DB_ROLE = "jobhunt_app";

const globalForDb = globalThis as unknown as { jobhuntDb?: PrismaClient };

function createClient(): PrismaClient {
  const { DATABASE_URL: url, DATABASE_POOL_MAX: max } = getServerEnv();
  if (!url) {
    throw new AppError("DATABASE_ERROR", {
      message: "DATABASE_URL is not configured",
      publicMessage: "The database is not configured. See docs/setup.md.",
    });
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: url,
      max,
      // Retire idle connections before the database/pooler closes them (long local AI calls leave
      // the pool idle for minutes), and keep TCP alive so dead peers are detected.
      idleTimeoutMillis: 30_000,
      keepAlive: true,
    }),
  });
}

/**
 * Owner-level client. Bypasses RLS — use ONLY for Better Auth, and privileged
 * maintenance (account deletion). All candidate data access goes through
 * withUserContext().
 */
export function getDb(): PrismaClient {
  globalForDb.jobhuntDb ??= createClient();
  return globalForDb.jobhuntDb;
}

/** Tests inject a client connected to a disposable database. */
export function setDbForTests(client: PrismaClient | undefined): void {
  globalForDb.jobhuntDb = client;
}

/**
 * Runs `fn` in a transaction as the RLS-restricted app role with the current
 * user bound. Even a query that forgets its `userId` filter can only see the
 * caller's rows. Services still filter by userId explicitly (defence in depth).
 */
/** Errors meaning the pooled connection was already dead (closed by the server/pooler). */
export function isDeadConnectionError(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}`
      : String(error);
  return /Connection terminated|terminating connection|ECONNRESET|Client has encountered a connection error|connection is closed/i.test(
    text,
  );
}

export async function withUserContext<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!isUuid(userId)) throw new AppError("AUTH_ERROR", { message: "Invalid user id in context" });
  for (let attempt = 1; ; attempt++) {
    // True once the caller's work started: after that a retry could repeat side effects.
    let workStarted = false;
    try {
      return await getDb().$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
          await tx.$executeRawUnsafe(`SET LOCAL ROLE ${APP_DB_ROLE}`);
          workStarted = true;
          return fn(tx);
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    } catch (error) {
      // A stale pooled connection fails on the first statement, before any work ran — nothing
      // was written, so one retry on a fresh connection is safe.
      if (attempt === 1 && !workStarted && isDeadConnectionError(error)) continue;
      throw mapDbError(error);
    }
  }
}

/**
 * A transaction uses one connection, so its queries must not run concurrently
 * (pg deprecates overlapping client.query calls). Use these instead of Promise.all.
 */
export async function inSequence<T extends readonly (() => Promise<unknown>)[]>(
  tasks: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const task of tasks) results.push(await task());
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

export async function mapInSequence<I, O>(
  items: readonly I[],
  fn: (item: I) => Promise<O>,
): Promise<O[]> {
  const results: O[] = [];
  for (const item of items) results.push(await fn(item));
  return results;
}

/** Translate driver/Prisma errors into the standard taxonomy without leaking SQL. */
export function mapDbError(error: unknown): unknown {
  if (error instanceof AppError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return new AppError("CONFLICT", {
          cause: error,
          message: `Unique constraint: ${String(error.meta?.target ?? "")}`,
          publicMessage: "This item already exists.",
        });
      case "P2025":
        return new AppError("NOT_FOUND", { cause: error });
      case "P2003":
        return new AppError("VALIDATION_ERROR", {
          cause: error,
          publicMessage: "A referenced item does not exist.",
        });
      default:
        break;
    }
  }
  const text = error instanceof Error ? error.message : String(error);
  if (/violates check constraint/i.test(text)) {
    return new AppError("VALIDATION_ERROR", {
      cause: error,
      message: text,
      publicMessage: "Some values are inconsistent (for example an end date before a start date).",
    });
  }
  if (/duplicate key value/i.test(text)) {
    return new AppError("CONFLICT", {
      cause: error,
      message: text,
      publicMessage: "This item already exists.",
    });
  }
  if (/row-level security|permission denied/i.test(text)) {
    return new AppError("NOT_FOUND", { cause: error, message: text });
  }
  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    /prisma|database|connect/i.test(text)
  ) {
    return new AppError("DATABASE_ERROR", { cause: error, message: text, retryable: true });
  }
  return error;
}

/**
 * True when an error means the database is behind the code (a migration has not been
 * applied yet): Prisma P2021 (table missing) / P2022 (column missing), possibly wrapped.
 */
export function isSchemaOutOfDate(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code;
    if (code === "P2021" || code === "P2022") return true;
    if (e instanceof Error && /does not exist in the current database/i.test(e.message))
      return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
