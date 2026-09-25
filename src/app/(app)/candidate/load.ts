import "server-only";
import type { FieldContext } from "@/components/forms/field-control";
import { getCandidateOverview, listCountries } from "@/modules/candidate";
import { factLabel } from "@/modules/candidate/labels";
import type { Actor } from "@/server/session";

/** Everything the candidate pages need, loaded in two user-scoped transactions. */
export async function loadCandidate(actor: Actor) {
  const [overview, countries] = await Promise.all([
    getCandidateOverview(actor),
    listCountries(actor),
  ]);
  const countryOptions = countries.map((c) => ({
    value: c.code,
    label: c.isTargetMarket ? `${c.name} ★` : c.name,
  }));
  const context: FieldContext = {
    countries: countryOptions,
    experiences: overview.experiences.map((e) => ({
      value: e.id,
      label: factLabel("experience", e),
    })),
    projects: overview.projects.map((p) => ({ value: p.id, label: p.name })),
  };
  return { overview, context, countryOptions };
}
