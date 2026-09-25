import "server-only";
import { configuredBoards, isAtsSourceKey } from "@/modules/jobs/sources.schemas";
import { listSources } from "@/modules/jobs/sources.service";
import { listCategories, listCountries, listLocations } from "./config.service";
import type { ProfileFormOptions } from "./ui/profile-form";

type ActorRef = { userId: string };

/** Every option the Search Profile form offers, read from the database for this user. */
export async function loadProfileFormOptions(actor: ActorRef): Promise<ProfileFormOptions> {
  const [countries, locations, categories, sources] = await Promise.all([
    listCountries(actor),
    listLocations(actor),
    listCategories(actor),
    listSources(actor),
  ]);
  return {
    countries,
    locations: locations.map(({ aliases: _aliases, ...l }) => l),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      termCount: c.terms.length,
      own: c.own,
    })),
    sources: sources
      .filter((s) => isAtsSourceKey(s.sourceKey))
      .map((s) => ({
        key: s.sourceKey,
        name: s.sourceName,
        enabled: s.enabled,
        boards: isAtsSourceKey(s.sourceKey)
          ? configuredBoards(s.sourceKey, s.configuration).length
          : 0,
      })),
  };
}
