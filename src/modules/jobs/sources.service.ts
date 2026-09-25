import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/session";
import {
  configuredIdentifiers,
  isSourceKey,
  RATE_LIMIT_DEFAULTS,
  SOURCE_DEFINITIONS,
  SOURCE_KEYS,
  sourceConfigInput,
  type SourceKey,
} from "./sources.schemas";

/**
 * Source management use cases. Source configuration is USER-OWNED: every query
 * is scoped by actor.userId and runs under RLS (withUserContext).
 */

export type ActorRef = Pick<Actor, "userId">;

function inUserTx<T>(actor: ActorRef, tx: Tx | undefined, fn: (tx: Tx) => Promise<T>) {
  return tx ? fn(tx) : withUserContext(actor.userId, fn);
}

function reviewedAt(key: SourceKey): Date | null {
  const v = SOURCE_DEFINITIONS[key].verification;
  return v ? new Date(`${v.reviewedOn}T00:00:00.000Z`) : null;
}

/**
 * Create any missing default source records for this user and bring existing
 * rows in line with the registry's documentation review (idempotent).
 * Status is NOT changed here: a connector only becomes READY after a successful
 * live test of the user's own boards.
 */
export async function ensureDefaultSources(actor: ActorRef, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const existing = await t.jobSource.findMany({
      where: { userId: actor.userId },
      select: { id: true, sourceKey: true, termsStatus: true },
    });
    for (const row of existing) {
      if (!isSourceKey(row.sourceKey)) continue;
      const def = SOURCE_DEFINITIONS[row.sourceKey];
      if (def.initialTerms === "VERIFIED" && row.termsStatus === "NOT_REVIEWED") {
        await t.jobSource.update({
          where: { id: row.id },
          data: { termsStatus: "VERIFIED", termsReviewedAt: reviewedAt(row.sourceKey) },
        });
      }
    }
    const have = new Set(existing.map((s) => s.sourceKey));
    const missing = SOURCE_KEYS.filter((key) => !have.has(key));
    if (missing.length === 0) return 0;
    await t.jobSource.createMany({
      data: missing.map((key) => {
        const def = SOURCE_DEFINITIONS[key];
        return {
          userId: actor.userId,
          sourceKey: key,
          sourceName: def.name,
          sourceType: def.sourceType,
          status: def.initialStatus,
          accessMethod: def.accessMethod,
          termsStatus: def.initialTerms,
          termsReviewedAt: reviewedAt(key),
          enabled: def.enabledByDefault,
          configuration: {},
          rateLimitSettings: key === "MANUAL" ? {} : { ...RATE_LIMIT_DEFAULTS },
        };
      }),
      skipDuplicates: true,
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "sources_initialized",
      resourceType: "job_source",
      metadata: { sources: missing },
    });
    return missing.length;
  });
}

export async function listSources(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    await ensureDefaultSources(actor, t);
    const sources = await t.jobSource.findMany({ where: { userId: actor.userId } });
    const order = new Map(SOURCE_KEYS.map((k, i) => [k, i]));
    return sources.sort(
      (a, b) =>
        (order.get(a.sourceKey as SourceKey) ?? 9) - (order.get(b.sourceKey as SourceKey) ?? 9),
    );
  });
}

export async function getSource(actor: ActorRef, sourceId: string, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    const source = await t.jobSource.findFirst({ where: { id: sourceId, userId: actor.userId } });
    if (!source) throw new AppError("NOT_FOUND");
    return source;
  });
}

export async function getSourceByKey(actor: ActorRef, key: SourceKey, tx?: Tx) {
  return inUserTx(actor, tx, async (t) => {
    await ensureDefaultSources(actor, t);
    const source = await t.jobSource.findFirst({ where: { userId: actor.userId, sourceKey: key } });
    if (!source) throw new AppError("NOT_FOUND");
    return source;
  });
}

export async function updateSourceConfiguration(
  actor: ActorRef,
  sourceId: string,
  rawInput: unknown,
) {
  return withUserContext(actor.userId, async (t) => {
    const source = await getSource(actor, sourceId, t);
    if (!isSourceKey(source.sourceKey))
      throw new AppError("VALIDATION_ERROR", { message: "Unknown source key" });
    const input = sourceConfigInput(source.sourceKey).parse(rawInput) as Record<string, unknown>;
    const {
      notes,
      requestsPerMinute,
      maxPagesPerSync,
      maxJobsPerSync,
      timeoutMs,
      ...configuration
    } = input;
    const rateLimitSettings =
      source.sourceKey === "MANUAL"
        ? {}
        : { requestsPerMinute, maxPagesPerSync, maxJobsPerSync, timeoutMs };

    // Removing every identifier from an enabled ATS source disables it (nothing left to sync).
    const stillConfigured =
      source.sourceKey === "MANUAL" ||
      configuredIdentifiers(source.sourceKey, configuration).length > 0;
    const updated = await t.jobSource.update({
      where: { id: source.id },
      data: {
        configuration: configuration as object,
        rateLimitSettings: rateLimitSettings as object,
        notes: (notes as string | null) ?? null,
        ...(source.enabled && !stillConfigured ? { enabled: false } : {}),
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "source_updated",
      resourceType: "job_source",
      resourceId: source.id,
      metadata: {
        sourceKey: source.sourceKey,
        identifiers: configuredIdentifiers(source.sourceKey, configuration).length,
        autoDisabled: source.enabled && !stillConfigured,
      },
    });
    return updated;
  });
}

export async function setSourceEnabled(actor: ActorRef, sourceId: string, enabled: boolean) {
  return withUserContext(actor.userId, async (t) => {
    const source = await getSource(actor, sourceId, t);
    if (!isSourceKey(source.sourceKey))
      throw new AppError("VALIDATION_ERROR", { message: "Unknown source key" });
    if (source.enabled === enabled) return source;
    if (
      enabled &&
      source.sourceKey !== "MANUAL" &&
      configuredIdentifiers(source.sourceKey, source.configuration).length === 0
    ) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `Configure at least one ${SOURCE_DEFINITIONS[source.sourceKey].name} board before enabling this source.`,
      });
    }
    const updated = await t.jobSource.update({ where: { id: source.id }, data: { enabled } });
    await recordAudit(t, {
      userId: actor.userId,
      action: enabled ? "source_enabled" : "source_disabled",
      resourceType: "job_source",
      resourceId: source.id,
      metadata: { sourceKey: source.sourceKey },
    });
    return updated;
  });
}
