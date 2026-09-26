import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { parseSearchParams, savedParams, type JobSearchParams } from "./params";

/**
 * Saved searches — a user's saved /jobs query + filter state. Distinct from Search
 * Profiles (which configure discovery). Owner-only (service filter + RLS).
 */

type ActorRef = { userId: string };

export const savedSearchName = z.string().trim().min(1, "Enter a name").max(100);

function fieldError(path: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", { details: [{ path, message }] });
}

/** Only validated, canonical params are ever stored (unknown keys and invalid values dropped). */
function canonical(raw: Record<string, string | string[] | undefined>) {
  return savedParams(parseSearchParams(raw).params);
}

function conflict(error: unknown): boolean {
  return error instanceof AppError && error.code === "CONFLICT";
}

export async function listSavedSearches(actor: ActorRef) {
  return withUserContext(actor.userId, (t) =>
    t.savedSearch.findMany({
      where: { userId: actor.userId },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    }),
  );
}

export async function getSavedSearch(actor: ActorRef, id: string) {
  const found = await withUserContext(actor.userId, (t) =>
    t.savedSearch.findFirst({ where: { id, userId: actor.userId } }),
  );
  if (!found) throw new AppError("NOT_FOUND");
  return found;
}

/** The stored state as search params (re-validated on every read). */
export function savedSearchParams(saved: { params: unknown }): JobSearchParams {
  const raw = (saved.params && typeof saved.params === "object" ? saved.params : {}) as Record<
    string,
    string | string[]
  >;
  return parseSearchParams(raw).params;
}

export async function createSavedSearch(
  actor: ActorRef,
  input: { name: unknown; params: Record<string, string | string[] | undefined> },
) {
  const name = savedSearchName.parse(input.name);
  try {
    return await withUserContext(actor.userId, async (t) => {
      const saved = await t.savedSearch.create({
        data: { userId: actor.userId, name, params: canonical(input.params) },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "saved_search_created",
        resourceType: "saved_search",
        resourceId: saved.id,
      });
      return saved;
    });
  } catch (error) {
    if (conflict(error)) fieldError("name", "You already have a saved search with this name");
    throw error;
  }
}

/** Rename and/or replace the stored filters. */
export async function updateSavedSearch(
  actor: ActorRef,
  id: string,
  input: { name?: unknown; params?: Record<string, string | string[] | undefined> },
) {
  const name = input.name === undefined ? undefined : savedSearchName.parse(input.name);
  try {
    return await withUserContext(actor.userId, async (t) => {
      const existing = await t.savedSearch.findFirst({ where: { id, userId: actor.userId } });
      if (!existing) throw new AppError("NOT_FOUND");
      const saved = await t.savedSearch.update({
        where: { id: existing.id },
        data: {
          ...(name ? { name } : {}),
          ...(input.params ? { params: canonical(input.params) } : {}),
        },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "saved_search_updated",
        resourceType: "saved_search",
        resourceId: id,
        metadata: { renamed: Boolean(name), filtersReplaced: Boolean(input.params) },
      });
      return saved;
    });
  } catch (error) {
    if (conflict(error)) fieldError("name", "You already have a saved search with this name");
    throw error;
  }
}

export async function duplicateSavedSearch(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await t.savedSearch.findFirst({ where: { id, userId: actor.userId } });
    if (!source) throw new AppError("NOT_FOUND");
    let name = `${source.name} (copy)`.slice(0, 100);
    for (let i = 2; await t.savedSearch.findFirst({ where: { userId: actor.userId, name } }); i++)
      name = `${source.name} (copy ${i})`.slice(0, 100);
    const copy = await t.savedSearch.create({
      data: { userId: actor.userId, name, params: source.params ?? {} },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "saved_search_duplicated",
      resourceType: "saved_search",
      resourceId: copy.id,
      metadata: { from: id },
    });
    return copy;
  });
}

export async function deleteSavedSearch(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.savedSearch.deleteMany({ where: { id, userId: actor.userId } });
    if (count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(t, {
      userId: actor.userId,
      action: "saved_search_deleted",
      resourceType: "saved_search",
      resourceId: id,
    });
  });
}

/** Marks a saved search as run and returns its params (the caller runs searchJobs). */
export async function runSavedSearch(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const saved = await t.savedSearch.findFirst({ where: { id, userId: actor.userId } });
    if (!saved) throw new AppError("NOT_FOUND");
    await t.savedSearch.update({ where: { id }, data: { lastRunAt: new Date() } });
    return { saved, params: savedSearchParams(saved) };
  });
}
