import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { ProfileCriteria, ProfileLocation } from "./criteria";
import { searchProfileInput, type SearchProfileInput } from "./schemas";
import type { LocationKind, VisaPreference } from "./types";

/**
 * Search Profiles — USER-OWNED saved discovery configurations ("what I want to find").
 * Ownership: every query filters by userId and RLS enforces the same rule.
 */

type ActorRef = { userId: string };

const profileInclude = {
  locations: { include: { location: true } },
  categories: { include: { category: { select: { id: true, key: true, name: true } } } },
  _count: { select: { hits: true } },
} satisfies Prisma.SearchProfileInclude;

export type SearchProfileRecord = Prisma.SearchProfileGetPayload<{
  include: typeof profileInclude;
}>;

function fieldError(path: string, message: string): never {
  throw new AppError("VALIDATION_ERROR", { details: [{ path, message }] });
}

/** Referenced countries, locations and categories must exist and be visible to the user. */
async function validateReferences(t: Tx, actor: ActorRef, input: SearchProfileInput) {
  if (input.countryCodes.length) {
    const found = await t.country.count({
      where: { code: { in: input.countryCodes }, isEnabled: true },
    });
    if (found !== input.countryCodes.length) fieldError("countryCodes", "Select valid countries");
  }
  if (input.locationIds.length) {
    const locations = await t.marketLocation.findMany({
      where: { id: { in: input.locationIds }, OR: [{ userId: null }, { userId: actor.userId }] },
      select: { id: true, name: true, countryCode: true },
    });
    if (locations.length !== input.locationIds.length)
      fieldError("locationIds", "Select valid locations");
    const outside = locations.filter(
      (l) => input.countryCodes.length && !input.countryCodes.includes(l.countryCode),
    );
    if (outside.length) {
      fieldError(
        "locationIds",
        `${outside.map((l) => l.name).join(", ")} ${outside.length === 1 ? "is" : "are"} not in the selected countries`,
      );
    }
  }
  if (input.categoryIds.length) {
    const found = await t.jobCategory.count({
      where: { id: { in: input.categoryIds }, OR: [{ userId: null }, { userId: actor.userId }] },
    });
    if (found !== input.categoryIds.length) fieldError("categoryIds", "Select valid categories");
  }
}

function columns(input: SearchProfileInput) {
  return {
    name: input.name,
    countryCodes: input.countryCodes,
    searchTerms: input.searchTerms,
    workModes: input.workModes,
    employmentTypes: input.employmentTypes,
    experienceLevels: input.experienceLevels,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    salaryCurrency: input.salaryCurrency,
    salaryPeriod: input.salaryPeriod,
    visaPreference: input.visaPreference,
    sourceKeys: input.sourceKeys,
    scheduleIntervalHours: input.scheduleIntervalHours,
  };
}

function nextRun(hours: number | null, from = new Date()) {
  return hours ? new Date(from.getTime() + hours * 3_600_000) : null;
}

async function replaceLinks(t: Tx, actor: ActorRef, profileId: string, input: SearchProfileInput) {
  await t.searchProfileLocation.deleteMany({ where: { profileId, userId: actor.userId } });
  await t.searchProfileCategory.deleteMany({ where: { profileId, userId: actor.userId } });
  if (input.locationIds.length) {
    await t.searchProfileLocation.createMany({
      data: input.locationIds.map((locationId) => ({
        profileId,
        locationId,
        userId: actor.userId,
      })),
    });
  }
  if (input.categoryIds.length) {
    await t.searchProfileCategory.createMany({
      data: input.categoryIds.map((categoryId) => ({
        profileId,
        categoryId,
        userId: actor.userId,
      })),
    });
  }
}

function nameTaken(error: unknown): boolean {
  return error instanceof AppError && error.code === "CONFLICT";
}

export async function listSearchProfiles(actor: ActorRef, tx?: Tx): Promise<SearchProfileRecord[]> {
  const run = (t: Tx) =>
    t.searchProfile.findMany({
      where: { userId: actor.userId },
      include: profileInclude,
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
    });
  return tx ? run(tx) : withUserContext(actor.userId, run);
}

export async function getSearchProfile(
  actor: ActorRef,
  id: string,
  tx?: Tx,
): Promise<SearchProfileRecord> {
  const run = (t: Tx) =>
    t.searchProfile.findFirst({ where: { id, userId: actor.userId }, include: profileInclude });
  const profile = await (tx ? run(tx) : withUserContext(actor.userId, run));
  if (!profile) throw new AppError("NOT_FOUND");
  return profile;
}

export async function createSearchProfile(actor: ActorRef, raw: unknown) {
  const input = searchProfileInput.parse(raw);
  try {
    return await withUserContext(actor.userId, async (t) => {
      await validateReferences(t, actor, input);
      const profile = await t.searchProfile.create({
        data: {
          ...columns(input),
          userId: actor.userId,
          nextRunAt: nextRun(input.scheduleIntervalHours),
        },
      });
      await replaceLinks(t, actor, profile.id, input);
      await recordAudit(t, {
        userId: actor.userId,
        action: "search_profile_created",
        resourceType: "search_profile",
        resourceId: profile.id,
      });
      return profile;
    });
  } catch (error) {
    if (nameTaken(error)) fieldError("name", "You already have a profile with this name");
    throw error;
  }
}

export async function updateSearchProfile(actor: ActorRef, id: string, raw: unknown) {
  const input = searchProfileInput.parse(raw);
  try {
    return await withUserContext(actor.userId, async (t) => {
      const existing = await t.searchProfile.findFirst({ where: { id, userId: actor.userId } });
      if (!existing) throw new AppError("NOT_FOUND");
      await validateReferences(t, actor, input);
      const scheduleChanged = existing.scheduleIntervalHours !== input.scheduleIntervalHours;
      const profile = await t.searchProfile.update({
        where: { id: existing.id },
        data: {
          ...columns(input),
          ...(scheduleChanged ? { nextRunAt: nextRun(input.scheduleIntervalHours) } : {}),
        },
      });
      await replaceLinks(t, actor, profile.id, input);
      await recordAudit(t, {
        userId: actor.userId,
        action: "search_profile_updated",
        resourceType: "search_profile",
        resourceId: profile.id,
      });
      return profile;
    });
  } catch (error) {
    if (nameTaken(error)) fieldError("name", "You already have a profile with this name");
    throw error;
  }
}

export async function duplicateSearchProfile(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await getSearchProfile(actor, id, t);
    let name = `${source.name} (copy)`.slice(0, 100);
    for (
      let i = 2;
      await t.searchProfile.findFirst({ where: { userId: actor.userId, name } });
      i++
    ) {
      name = `${source.name} (copy ${i})`.slice(0, 100);
    }
    const copy = await t.searchProfile.create({
      data: {
        userId: actor.userId,
        name,
        enabled: false,
        countryCodes: source.countryCodes,
        searchTerms: source.searchTerms,
        workModes: source.workModes,
        employmentTypes: source.employmentTypes,
        experienceLevels: source.experienceLevels,
        salaryMin: source.salaryMin,
        salaryMax: source.salaryMax,
        salaryCurrency: source.salaryCurrency,
        salaryPeriod: source.salaryPeriod,
        visaPreference: source.visaPreference,
        sourceKeys: source.sourceKeys,
        scheduleIntervalHours: null,
      },
    });
    if (source.locations.length) {
      await t.searchProfileLocation.createMany({
        data: source.locations.map((l) => ({
          profileId: copy.id,
          locationId: l.locationId,
          userId: actor.userId,
        })),
      });
    }
    if (source.categories.length) {
      await t.searchProfileCategory.createMany({
        data: source.categories.map((c) => ({
          profileId: copy.id,
          categoryId: c.categoryId,
          userId: actor.userId,
        })),
      });
    }
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_profile_duplicated",
      resourceType: "search_profile",
      resourceId: copy.id,
      metadata: { from: source.id },
    });
    return copy;
  });
}

export async function setSearchProfileEnabled(actor: ActorRef, id: string, enabled: boolean) {
  return withUserContext(actor.userId, async (t) => {
    const existing = await t.searchProfile.findFirst({ where: { id, userId: actor.userId } });
    if (!existing) throw new AppError("NOT_FOUND");
    const profile = await t.searchProfile.update({
      where: { id },
      data: { enabled, nextRunAt: enabled ? nextRun(existing.scheduleIntervalHours) : null },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: enabled ? "search_profile_enabled" : "search_profile_disabled",
      resourceType: "search_profile",
      resourceId: id,
    });
    return profile;
  });
}

/** Deletes the profile and its job links. Canonical jobs are never deleted. */
export async function deleteSearchProfile(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.searchProfile.deleteMany({ where: { id, userId: actor.userId } });
    if (count === 0) throw new AppError("NOT_FOUND");
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_profile_deleted",
      resourceType: "search_profile",
      resourceId: id,
    });
  });
}

/**
 * Builds evaluation criteria for a profile: selected categories contribute ALL their
 * visible terms (system + the user's own) on top of the profile's own search terms.
 */
export async function criteriaForProfile(
  t: Tx,
  actor: ActorRef,
  profile: SearchProfileRecord,
): Promise<ProfileCriteria> {
  const categoryIds = profile.categories.map((c) => c.categoryId);
  const terms = categoryIds.length
    ? await t.jobCategoryTerm.findMany({
        where: {
          categoryId: { in: categoryIds },
          OR: [{ userId: null }, { userId: actor.userId }],
        },
        select: { term: true },
      })
    : [];
  const locations: ProfileLocation[] = profile.locations.map((l) => ({
    id: l.location.id,
    countryCode: l.location.countryCode,
    name: l.location.name,
    kind: l.location.kind as LocationKind,
    aliases: l.location.aliases,
  }));
  return {
    countryCodes: profile.countryCodes,
    locations,
    categoryIds,
    terms: [...new Set([...terms.map((x) => x.term), ...profile.searchTerms])],
    workModes: profile.workModes,
    employmentTypes: profile.employmentTypes,
    experienceLevels: profile.experienceLevels,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryCurrency: profile.salaryCurrency,
    salaryPeriod: profile.salaryPeriod,
    visaPreference: profile.visaPreference as VisaPreference,
  };
}

/** Form values for editing (arrays of ids, newline-separated terms). */
export function profileFormValues(p: SearchProfileRecord) {
  return {
    name: p.name,
    countryCodes: p.countryCodes,
    locationIds: p.locations.map((l) => l.locationId),
    categoryIds: p.categories.map((c) => c.categoryId),
    searchTerms: p.searchTerms.join("\n"),
    workModes: p.workModes,
    employmentTypes: p.employmentTypes,
    experienceLevels: p.experienceLevels,
    salaryMin: p.salaryMin ?? "",
    salaryMax: p.salaryMax ?? "",
    salaryCurrency: p.salaryCurrency ?? "",
    salaryPeriod: p.salaryPeriod ?? "",
    visaPreference: p.visaPreference,
    sourceKeys: p.sourceKeys,
    scheduleIntervalHours: p.scheduleIntervalHours ? String(p.scheduleIntervalHours) : "",
  };
}
