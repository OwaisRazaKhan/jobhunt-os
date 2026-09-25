import "server-only";
import { recordAudit } from "@/server/audit";
import { getDb, inSequence, withUserContext } from "@/server/db";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import type { ActorRef } from "./facts.service";
import { getProfile } from "./profile.service";

const log = logger.child({ module: "candidate.account" });

/**
 * Data export: everything JOBHUNT OS stores about the user, as JSON.
 * Uploaded files themselves are downloadable from the document library.
 */
export async function exportCandidateData(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const where = { userId: actor.userId };
    const [
      user,
      profile,
      education,
      experiences,
      achievements,
      skills,
      projects,
      certifications,
      portfolioItems,
      languages,
      workAuthorizations,
      preferences,
      targetLocations,
      documents,
      factCandidates,
      aiGenerations,
      auditLog,
    ] = await inSequence([
      () =>
        t.user.findUnique({
          where: { id: actor.userId },
          select: { id: true, email: true, name: true, createdAt: true },
        }),
      () => getProfile(actor, t),
      () => t.candidateEducation.findMany({ where }),
      () => t.candidateExperience.findMany({ where }),
      () => t.candidateAchievement.findMany({ where }),
      () => t.candidateSkill.findMany({ where }),
      () => t.candidateProject.findMany({ where }),
      () => t.candidateCertification.findMany({ where }),
      () => t.candidatePortfolioItem.findMany({ where }),
      () => t.candidateLanguage.findMany({ where }),
      () => t.candidateWorkAuthorization.findMany({ where }),
      () => t.candidatePreferences.findUnique({ where }),
      () => t.candidateTargetLocation.findMany({ where }),
      () => t.candidateDocument.findMany({ where, omit: { storagePath: true } }),
      () => t.candidateFactCandidate.findMany({ where }),
      () => t.aiGeneration.findMany({ where }),
      () => t.auditLog.findMany({ where, orderBy: { createdAt: "asc" } }),
    ] as const);
    await recordAudit(t, {
      userId: actor.userId,
      action: "data_exported",
      resourceType: "account",
    });
    return {
      format: "jobhunt-os.candidate-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      user,
      profile,
      facts: {
        education,
        experiences,
        achievements,
        skills,
        projects,
        certifications,
        portfolioItems,
        languages,
        workAuthorizations,
      },
      preferences,
      targetLocations,
      documents,
      factCandidates,
      aiGenerations,
      auditLog,
    };
  });
}

/**
 * Wipe all candidate data but keep the account. Uploaded files are removed
 * from storage. Global catalog data (countries) is never touched.
 */
export async function deleteCandidateData(actor: ActorRef) {
  const paths = await withUserContext(actor.userId, async (t) => {
    const docs = await t.candidateDocument.findMany({
      where: { userId: actor.userId },
      select: { storagePath: true },
    });
    return docs.map((d) => d.storagePath);
  });
  await getStorage().remove(paths);
  await withUserContext(actor.userId, async (t) => {
    const where = { userId: actor.userId };
    // Children first; document deletion cascades fact candidates.
    await t.candidateAchievement.deleteMany({ where });
    await t.candidatePortfolioItem.deleteMany({ where });
    await t.candidateEducation.deleteMany({ where });
    await t.candidateExperience.deleteMany({ where });
    await t.candidateSkill.deleteMany({ where });
    await t.candidateProject.deleteMany({ where });
    await t.candidateCertification.deleteMany({ where });
    await t.candidateLanguage.deleteMany({ where });
    await t.candidateWorkAuthorization.deleteMany({ where });
    await t.candidateTargetLocation.deleteMany({ where });
    await t.candidatePreferences.deleteMany({ where });
    await t.candidateDocument.deleteMany({ where });
    await t.aiGeneration.deleteMany({ where });
    await t.candidateProfile.deleteMany({ where });
  });
  log.info("candidate data deleted", { userId: actor.userId, files: paths.length });
}

/**
 * Account deletion (called from Better Auth's beforeDelete hook): remove stored
 * files; the user row deletion then cascades every user-owned table, including
 * sessions, accounts and the audit trail. Shared catalog rows are not affected.
 */
export async function purgeUserFiles(userId: string) {
  const docs = await getDb().candidateDocument.findMany({
    where: { userId },
    select: { storagePath: true },
  });
  await getStorage().remove(docs.map((d) => d.storagePath));
  log.info("user files purged for account deletion", { userId, files: docs.length });
}

/** Hard-delete soft-deleted facts older than the retention window (default 30 days). */
export async function purgeSoftDeleted(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const db = getDb();
  const where = { deletedAt: { lt: cutoff } };
  const results = await db.$transaction([
    db.candidateAchievement.deleteMany({ where }),
    db.candidatePortfolioItem.deleteMany({ where }),
    db.candidateEducation.deleteMany({ where }),
    db.candidateExperience.deleteMany({ where }),
    db.candidateSkill.deleteMany({ where }),
    db.candidateProject.deleteMany({ where }),
    db.candidateCertification.deleteMany({ where }),
    db.candidateLanguage.deleteMany({ where }),
    db.candidateWorkAuthorization.deleteMany({ where }),
  ]);
  return results.reduce((sum, r) => sum + r.count, 0);
}

export async function listActivity(actor: ActorRef, limit = 100) {
  return withUserContext(actor.userId, (t) =>
    t.auditLog.findMany({
      where: { userId: actor.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  );
}
