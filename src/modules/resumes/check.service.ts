import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  alignRequirements,
  analyzeKeywords,
  type KeywordResult,
  type RequirementAlignment,
} from "./alignment";
import { CHECKER_VERSION, runResumeCheck, summarizeFindings } from "./check";
import { parseResumeDocument } from "./document";
import { loadJobContext } from "./job-context";
import { renderResumePdf } from "./render/pdf";
import { loadUsableFacts, type ActorRef } from "./resume.service";

/**
 * Runs and persists a Resume Check for a version. Deterministic, so a check for the same
 * content hash + job + checker version is reused instead of recomputed.
 * Page count comes from actually rendering the PDF.
 */
export async function runVersionCheck(
  actor: ActorRef,
  versionId: string,
  opts: { jobId?: string | null; force?: boolean } = {},
) {
  const version = await withUserContext(actor.userId, (t) =>
    t.resumeVersion.findFirst({
      where: { id: versionId, userId: actor.userId },
      include: { resume: { select: { id: true, template: true, pageFormat: true } } },
    }),
  );
  if (!version) throw new AppError("NOT_FOUND");
  const jobId = opts.jobId === undefined ? version.targetJobId : opts.jobId;

  if (!opts.force) {
    const cached = await withUserContext(actor.userId, (t) =>
      t.resumeCheck.findFirst({
        where: {
          versionId: version.id,
          userId: actor.userId,
          contentHash: version.contentHash,
          jobId: jobId ?? null,
          checkerVersion: CHECKER_VERSION,
        },
        include: { findings: true },
        orderBy: { createdAt: "desc" },
      }),
    );
    if (cached) return { check: cached, cached: true };
  }

  const doc = parseResumeDocument(version.content);
  let pages: number | null = null;
  try {
    pages = (
      await renderResumePdf(doc, {
        template: version.resume.template,
        pageFormat: version.resume.pageFormat,
      })
    ).pages;
  } catch (error) {
    logger.warn("resume check: pdf render failed", {
      versionId: version.id,
      error: error instanceof Error ? error.name : "unknown",
    });
  }

  let alignment;
  let keywords;
  let job = null;
  if (jobId) {
    const ctx = await loadJobContext(actor, jobId);
    const facts = await withUserContext(actor.userId, (t) => loadUsableFacts(actor, t));
    alignment = alignRequirements(
      ctx.requirements.filter((r) => !r.id.startsWith("research:")),
      facts,
      doc,
    );
    keywords = analyzeKeywords(
      ctx.job,
      ctx.requirements.filter((r) => !r.id.startsWith("research:")),
      facts,
      doc,
    );
    job = { title: ctx.job.title, company: ctx.job.company };
  }
  const findings = runResumeCheck({ doc, pages, job, alignment, keywords });
  const summary = {
    ...summarizeFindings(findings),
    pages,
    alignment: alignment ?? null,
    keywords: keywords ?? null,
  };

  const check = await withUserContext(actor.userId, async (t) => {
    const created = await t.resumeCheck.create({
      data: {
        userId: actor.userId,
        versionId: version.id,
        contentHash: version.contentHash,
        jobId: jobId ?? null,
        checkerVersion: CHECKER_VERSION,
        summary: summary as unknown as Prisma.InputJsonValue,
        findings: {
          create: findings.map((f) => ({
            userId: actor.userId,
            category: f.category,
            code: f.code,
            severity: f.severity,
            message: f.message.slice(0, 1000),
            recommendation: f.recommendation?.slice(0, 1000) ?? null,
            itemId: f.itemId,
            evidence: f.evidence as Prisma.InputJsonValue,
          })),
        },
      },
      include: { findings: true },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_checked",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: {
        checkId: created.id,
        issues: summary.issues,
        warnings: summary.warnings,
        jobId: jobId ?? null,
      },
    });
    return created;
  });
  return { check, cached: false };
}

export type CheckSummaryView = ReturnType<typeof summarizeFindings> & {
  pages: number | null;
  alignment: RequirementAlignment[] | null;
  keywords: KeywordResult[] | null;
};
