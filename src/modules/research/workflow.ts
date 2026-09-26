import "server-only";
import { z } from "zod";
import {
  researchCompany,
  researchJob,
  researchResultForCompany,
  researchResultForJob,
} from "./research.service";
import { depthSchema } from "./types";

/**
 * [RESEARCH] workflow node contract for the future canvas (Phase 9) — not wired to any UI.
 * Input {jobId | companyId, options?} → a serializable, versioned result:
 * {schemaVersion, engineVersion, status, freshness, jobResearch, companyResearch, forTailoring,
 *  evidenceIds, unknowns}. With `reuseIfFresh` (default true) current research is returned
 * without a new run. It never writes resumes, emails or applications.
 */
export const researchNodeInput = z
  .object({
    jobId: z.uuid().optional(),
    companyId: z.uuid().optional(),
    options: z
      .object({
        depth: depthSchema.optional(),
        refreshCompany: z.boolean().optional(),
        reuseIfFresh: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((v) => Boolean(v.jobId) !== Boolean(v.companyId), {
    message: "Give exactly one of jobId or companyId",
  });

export async function runResearchNode(actor: { userId: string }, raw: unknown) {
  const input = researchNodeInput.parse(raw);
  const { reuseIfFresh = true, ...options } = input.options ?? {};
  if (input.jobId) {
    if (reuseIfFresh) {
      const current = await researchResultForJob(actor, input.jobId);
      if (current.jobResearch && ["FRESH", "AGING"].includes(current.freshness)) return current;
    }
    return researchJob(actor, { jobId: input.jobId, options, trigger: "WORKFLOW" });
  }
  if (reuseIfFresh) {
    const current = await researchResultForCompany(actor, input.companyId!);
    if (current.companyResearch && ["FRESH", "AGING"].includes(current.freshness)) return current;
  }
  return researchCompany(actor, { companyId: input.companyId!, options, trigger: "WORKFLOW" });
}
