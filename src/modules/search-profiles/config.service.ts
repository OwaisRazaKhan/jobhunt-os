import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { categoryInput, locationInput, termInput } from "./schemas";
import type { LocationKind } from "./types";

/**
 * Search configuration data: countries, market locations, job categories and their
 * search terms. System defaults (user_id NULL) are read-only; users add their own rows.
 * Nothing here is hard-coded in discovery logic — it is all read from the database.
 */

type ActorRef = { userId: string };

export interface LocationOption {
  id: string;
  countryCode: string;
  name: string;
  kind: LocationKind;
  aliases: string[];
  own: boolean;
}

export interface CategoryWithTerms {
  id: string;
  key: string;
  name: string;
  description: string | null;
  own: boolean;
  terms: { id: string; term: string; own: boolean }[];
}

export async function listCountries(actor: ActorRef, tx?: Tx) {
  const run = (t: Tx) =>
    t.country.findMany({
      where: { isEnabled: true },
      select: { code: true, name: true, isTargetMarket: true },
      orderBy: [{ isTargetMarket: "desc" }, { name: "asc" }],
    });
  return tx ? run(tx) : withUserContext(actor.userId, run);
}

export async function listLocations(actor: ActorRef, tx?: Tx): Promise<LocationOption[]> {
  const run = (t: Tx) =>
    t.marketLocation.findMany({
      where: { OR: [{ userId: null }, { userId: actor.userId }] },
      orderBy: [{ countryCode: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
  const rows = await (tx ? run(tx) : withUserContext(actor.userId, run));
  return rows.map((r) => ({
    id: r.id,
    countryCode: r.countryCode,
    name: r.name,
    kind: r.kind as LocationKind,
    aliases: r.aliases,
    own: r.userId === actor.userId,
  }));
}

export async function listCategories(actor: ActorRef, tx?: Tx): Promise<CategoryWithTerms[]> {
  const run = (t: Tx) =>
    t.jobCategory.findMany({
      where: { OR: [{ userId: null }, { userId: actor.userId }] },
      include: {
        terms: {
          where: { OR: [{ userId: null }, { userId: actor.userId }] },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  const rows = await (tx ? run(tx) : withUserContext(actor.userId, run));
  return rows.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    description: c.description,
    own: c.userId === actor.userId,
    terms: c.terms.map((t) => ({ id: t.id, term: t.term, own: t.userId === actor.userId })),
  }));
}

function slugify(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "category"
  );
}

export async function addLocation(actor: ActorRef, raw: unknown) {
  const input = locationInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const country = await t.country.findUnique({ where: { code: input.countryCode } });
    if (!country) {
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "countryCode", message: "Select a country" }],
      });
    }
    const location = await t.marketLocation.create({
      data: { ...input, userId: actor.userId, sortOrder: 1000 },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "market_location",
      resourceId: location.id,
      metadata: { change: "location_added", countryCode: input.countryCode },
    });
    return location;
  });
}

export async function deleteLocation(actor: ActorRef, locationId: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.marketLocation.deleteMany({
      where: { id: locationId, userId: actor.userId },
    });
    if (count === 0)
      throw new AppError("NOT_FOUND", {
        publicMessage: "Only locations you added can be removed.",
      });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "market_location",
      resourceId: locationId,
      metadata: { change: "location_removed" },
    });
  });
}

export async function addCategory(actor: ActorRef, raw: unknown) {
  const input = categoryInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const base = `my-${slugify(input.name)}`;
    let key = base;
    for (let i = 2; await t.jobCategory.findFirst({ where: { userId: actor.userId, key } }); i++)
      key = `${base}-${i}`;
    const category = await t.jobCategory.create({
      data: {
        userId: actor.userId,
        key,
        name: input.name,
        description: input.description,
        sortOrder: 1000,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "job_category",
      resourceId: category.id,
      metadata: { change: "category_added" },
    });
    return category;
  });
}

export async function deleteCategory(actor: ActorRef, categoryId: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.jobCategory.deleteMany({
      where: { id: categoryId, userId: actor.userId },
    });
    if (count === 0)
      throw new AppError("NOT_FOUND", {
        publicMessage: "Only categories you created can be removed.",
      });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "job_category",
      resourceId: categoryId,
      metadata: { change: "category_removed" },
    });
  });
}

/** Adds a search term (not a skill claim) to a system or own category. */
export async function addTerm(actor: ActorRef, raw: unknown) {
  const input = termInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const category = await t.jobCategory.findFirst({
      where: { id: input.categoryId, OR: [{ userId: null }, { userId: actor.userId }] },
      include: {
        terms: {
          where: { OR: [{ userId: null }, { userId: actor.userId }] },
          select: { term: true },
        },
      },
    });
    if (!category) throw new AppError("NOT_FOUND");
    if (category.terms.some((x) => x.term.toLowerCase() === input.term.toLowerCase())) {
      throw new AppError("CONFLICT", { publicMessage: "This category already has that term." });
    }
    const term = await t.jobCategoryTerm.create({
      data: { categoryId: category.id, userId: actor.userId, term: input.term },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "job_category_term",
      resourceId: term.id,
      metadata: { change: "term_added", categoryKey: category.key },
    });
    return term;
  });
}

export async function deleteTerm(actor: ActorRef, termId: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.jobCategoryTerm.deleteMany({
      where: { id: termId, userId: actor.userId },
    });
    if (count === 0)
      throw new AppError("NOT_FOUND", { publicMessage: "Only terms you added can be removed." });
    await recordAudit(t, {
      userId: actor.userId,
      action: "search_config_updated",
      resourceType: "job_category_term",
      resourceId: termId,
      metadata: { change: "term_removed" },
    });
  });
}
