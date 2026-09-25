import "server-only";
import { ZodError } from "zod";
import type { ActionState } from "@/lib/action-state";
import { AppError, toAppError } from "./errors";
import { logger } from "./logger";

/**
 * Wraps a Server Action body: converts validation/domain errors into a safe
 * ActionState for the client and logs unexpected failures (metadata only).
 */
export async function runAction(
  fn: () => Promise<Partial<ActionState> | void>,
): Promise<ActionState> {
  try {
    const result = await fn();
    return { ok: true, at: Date.now(), ...(result ?? {}) };
  } catch (thrown) {
    if (isRedirect(thrown)) throw thrown;
    if (thrown instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of thrown.issues) {
        const key = String(issue.path[0] ?? "form");
        fieldErrors[key] ??= issue.message;
      }
      return {
        ok: false,
        at: Date.now(),
        error: "Please fix the highlighted fields.",
        fieldErrors,
      };
    }
    const error = toAppError(thrown);
    if (error.status >= 500) {
      logger.error("action failed", {
        code: error.code,
        error: thrown instanceof Error ? { name: thrown.name, message: error.message } : undefined,
      });
    }
    const fieldErrors = error.details?.reduce<Record<string, string>>((acc, d) => {
      if (d.path) acc[d.path] ??= d.message;
      return acc;
    }, {});
    return { ok: false, at: Date.now(), error: error.publicMessage, fieldErrors };
  }
}

function isRedirect(error: unknown): boolean {
  // next/navigation redirect() and notFound() throw special errors that must propagate.
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK"))
  );
}

export { AppError };
