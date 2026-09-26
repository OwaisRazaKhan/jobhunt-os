import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getProfile } from "@/modules/candidate/profile.service";
import { parseResumeDocument } from "@/modules/resumes/document";
import { resumeContentHash } from "@/modules/resumes/hash";
import { loadUsableFacts } from "@/modules/resumes/resume.service";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { captureContext, runCommunicationCheck, type ActorRef } from "./communication.service";
import { parseCommunicationDocument } from "./document";
import { communicationContentHash } from "./hash";
import {
  ASSET_TYPES,
  evaluatePackage,
  FROZEN_STATUSES,
  nextStatus,
  packageIntegrityHash,
  PACKAGE_CHANNELS,
  requiredAssets,
  type AssetState,
  type AssetType,
  type Evaluation,
  type PackageChannel,
  type PackageStatus,
} from "./package";

/**
 * Communication Package service — the exact approved assets for one job, and the formal
 * Phase 7 → Phase 8 boundary (`getCommunicationPackageForApplication`).
 *  - packages reference exact versions (never "latest"); editable until READY_FOR_APPLICATION
 *  - READY_FOR_APPLICATION freezes the package (DB trigger); later changes mark it STALE / INVALID,
 *    never mutate it — updating means creating a new package
 *  - nothing here submits, sends or applies
 */

const uuidOrNull = z.preprocess(
  (v) => (v === "" || v === undefined ? null : v),
  z.uuid().nullable(),
);

export const packageInput = z
  .object({
    jobId: z.uuid(),
    channel: z.enum(PACKAGE_CHANNELS).default("PORTAL"),
    includeEmail: z
      .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
      .default(false),
    includeCoverLetter: z
      .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
      .default(false),
    resumeVersionId: uuidOrNull.default(null),
    emailVersionId: uuidOrNull.default(null),
    coverLetterVersionId: uuidOrNull.default(null),
    recipientContextId: uuidOrNull.default(null),
    title: z.preprocess(
      (v) => (typeof v === "string" && !v.trim() ? undefined : v),
      z.string().trim().max(200).optional(),
    ),
  })
  .transform((v) => ({ ...v, includeEmail: v.channel === "EMAIL" ? true : v.includeEmail }));
export type PackageInput = z.input<typeof packageInput>;

async function ownedPackage(t: Tx, actor: ActorRef, id: string) {
  const p = await t.communicationPackage.findFirst({
    where: { id, userId: actor.userId },
    include: { assets: true },
  });
  if (!p) throw new AppError("NOT_FOUND");
  return p;
}

// --- Snapshots ------------------------------------------------------------------------------

function recipientSnapshot(
  r: {
    id: string;
    name: string | null;
    title: string | null;
    company: string | null;
    email: string | null;
    recipientType: string;
    source: string;
    sourceUrl: string | null;
    verificationStatus: string;
    confidence: string;
  } | null,
) {
  return r
    ? {
        id: r.id,
        name: r.name,
        title: r.title,
        company: r.company,
        email: r.email,
        recipientType: r.recipientType,
        source: r.source,
        sourceUrl: r.sourceUrl,
        verificationStatus: r.verificationStatus,
        confidence: r.confidence,
      }
    : {};
}

async function strategySnapshot(t: Tx, actor: ActorRef, versionIds: string[]) {
  const out: Record<string, unknown> = {};
  for (const id of versionIds) {
    const v = await t.communicationVersion.findFirst({
      where: { id, userId: actor.userId },
      include: { communication: true },
    });
    if (!v) continue;
    const c = v.communication;
    out[c.kind === "EMAIL" ? "email" : "coverLetter"] = {
      purpose: c.communicationType,
      recipientType: c.recipientType,
      tone: c.tone,
      length: c.length,
      userContext: c.userContext,
      ...(c.strategy as Record<string, unknown>),
    };
  }
  return out;
}

/** Validates the selected versions belong to the user, have the right kind and target this job. */
async function assetRows(
  t: Tx,
  actor: ActorRef,
  jobId: string,
  input: {
    resumeVersionId: string | null;
    emailVersionId: string | null;
    coverLetterVersionId: string | null;
  },
) {
  const rows: {
    assetType: AssetType;
    resumeVersionId: string | null;
    communicationVersionId: string | null;
    contentHash: string;
  }[] = [];
  if (input.resumeVersionId) {
    const v = await t.resumeVersion.findFirst({
      where: { id: input.resumeVersionId, userId: actor.userId },
    });
    if (!v)
      throw new AppError("NOT_FOUND", {
        publicMessage: "The selected resume version was not found.",
      });
    rows.push({
      assetType: "RESUME",
      resumeVersionId: v.id,
      communicationVersionId: null,
      contentHash: v.contentHash,
    });
  }
  for (const [type, id, kind] of [
    ["EMAIL", input.emailVersionId, "EMAIL"],
    ["COVER_LETTER", input.coverLetterVersionId, "COVER_LETTER"],
  ] as const) {
    if (!id) continue;
    const v = await t.communicationVersion.findFirst({
      where: { id, userId: actor.userId },
      include: { communication: { select: { kind: true, jobId: true } } },
    });
    if (!v)
      throw new AppError("NOT_FOUND", {
        publicMessage: `The selected ${type === "EMAIL" ? "email" : "cover letter"} version was not found.`,
      });
    if (v.communication.kind !== kind)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `The selected version is not ${kind === "EMAIL" ? "an email" : "a cover letter"}.`,
      });
    if (v.communication.jobId !== jobId)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `The selected ${type === "EMAIL" ? "email" : "cover letter"} was written for a different job.`,
      });
    rows.push({
      assetType: type,
      resumeVersionId: null,
      communicationVersionId: v.id,
      contentHash: v.contentHash,
    });
  }
  return rows;
}

/** Current context references for an editable package (frozen packages keep theirs). */
async function currentContext(
  t: Tx,
  actor: ActorRef,
  jobId: string,
  resumeVersionId: string | null,
) {
  const ctx = await captureContext(t, actor, jobId, resumeVersionId);
  const job = await t.job.findFirst({
    where: { id: jobId },
    select: {
      contentHash: true,
      companyId: true,
      title: true,
      company: { select: { name: true } },
    },
  });
  return { ctx, job };
}

// --- Evaluation --------------------------------------------------------------------------------

async function buildEvaluationInput(
  t: Tx,
  actor: ActorRef,
  pkg: Awaited<ReturnType<typeof ownedPackage>>,
) {
  const frozen = (FROZEN_STATUSES as readonly string[]).includes(pkg.status);
  const profile = await getProfile(actor, t);
  const facts = await loadUsableFacts(actor, t);
  const job = await t.job.findFirst({
    where: { id: pkg.jobId, OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }] },
    select: { id: true, contentHash: true, deletedAt: true },
  });
  const match = pkg.matchId
    ? await t.jobMatch.findFirst({
        where: { id: pkg.matchId, userId: actor.userId },
        select: { id: true, jobId: true, isCurrent: true },
      })
    : null;
  const requirementSet = pkg.requirementSetId
    ? await t.jobRequirementSet.findFirst({
        where: { id: pkg.requirementSetId },
        select: { id: true, isCurrent: true },
      })
    : null;
  const research = pkg.jobResearchId
    ? await t.jobResearch.findFirst({
        where: { id: pkg.jobResearchId, userId: actor.userId },
        select: { id: true, version: true, isCurrent: true },
      })
    : null;

  const assets: Partial<Record<AssetType, AssetState>> = {};
  const resumeRow = pkg.assets.find((a) => a.assetType === "RESUME");
  for (const row of pkg.assets) {
    if (row.resumeVersionId) {
      const v = await t.resumeVersion.findFirst({
        where: { id: row.resumeVersionId, userId: actor.userId },
        include: {
          approvals: { where: { revokedAt: null }, orderBy: { approvedAt: "desc" }, take: 1 },
        },
      });
      if (!v) continue;
      let recomputed: string | null = null;
      try {
        recomputed = resumeContentHash(parseResumeDocument(v.content));
      } catch {
        recomputed = null;
      }
      const newer = await t.resumeVersion.findFirst({
        where: {
          resumeId: v.resumeId,
          userId: actor.userId,
          status: "APPROVED",
          versionNumber: { gt: v.versionNumber },
        },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const edited =
        v.status === "APPROVED"
          ? await t.resumeVersion.count({
              where: { parentVersionId: v.id, userId: actor.userId, versionType: "MANUAL_EDIT" },
            })
          : 0;
      assets.RESUME = {
        type: "RESUME",
        versionId: v.id,
        versionNumber: v.versionNumber,
        selectedHash: row.contentHash,
        storedHash: v.contentHash,
        recomputedHash: recomputed,
        status: v.status,
        activeApproval: v.approvals[0]
          ? { id: v.approvals[0].id, contentHash: v.approvals[0].contentHash }
          : null,
        recordedApprovalId: row.approvalId,
        jobConsistent: !v.targetJobId || v.targetJobId === pkg.jobId,
        jobDetail: "The resume version was tailored for a different job.",
        check: null,
        newerApprovedVersion: newer?.versionNumber ?? null,
        editedAfterApproval: edited > 0,
      };
    } else if (row.communicationVersionId) {
      const v = await t.communicationVersion.findFirst({
        where: { id: row.communicationVersionId, userId: actor.userId },
        include: {
          communication: { select: { id: true, jobId: true, recipientEmail: true } },
          approvals: { where: { revokedAt: null }, orderBy: { approvedAt: "desc" }, take: 1 },
        },
      });
      if (!v) continue;
      let recomputed: string | null = null;
      try {
        recomputed = communicationContentHash(parseCommunicationDocument(v.content));
      } catch {
        recomputed = null;
      }
      const latestCheck = await t.communicationCheck.findFirst({
        where: { versionId: v.id, userId: actor.userId },
        orderBy: { createdAt: "desc" },
      });
      const unsupported = await t.communicationClaim.count({
        where: { versionId: v.id, userId: actor.userId, status: "UNSUPPORTED" },
      });
      const newer = await t.communicationVersion.findFirst({
        where: {
          communicationId: v.communicationId,
          userId: actor.userId,
          status: "APPROVED",
          versionNumber: { gt: v.versionNumber },
        },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const edited =
        v.status === "APPROVED"
          ? await t.communicationVersion.count({
              where: { parentVersionId: v.id, userId: actor.userId, versionType: "MANUAL_EDIT" },
            })
          : 0;
      const type = row.assetType as AssetType;
      assets[type] = {
        type,
        versionId: v.id,
        versionNumber: v.versionNumber,
        selectedHash: row.contentHash,
        storedHash: v.contentHash,
        recomputedHash: recomputed,
        status: v.status,
        activeApproval: v.approvals[0]
          ? { id: v.approvals[0].id, contentHash: v.approvals[0].contentHash }
          : null,
        recordedApprovalId: row.approvalId,
        jobConsistent: v.communication.jobId === pkg.jobId,
        check:
          latestCheck && latestCheck.contentHash === v.contentHash
            ? {
                critical: (latestCheck.summary as { critical?: number }).critical ?? 0,
                unsupported,
              }
            : null,
        newerApprovedVersion: newer?.versionNumber ?? null,
        editedAfterApproval: edited > 0,
        recipientEmail: v.communication.recipientEmail,
        resumeVersionId: v.resumeVersionId,
      };
    }
  }

  let recipient: Parameters<typeof evaluatePackage>[0]["recipient"] = null;
  if (pkg.recipientContextId) {
    const r = await t.recipientContext.findFirst({
      where: { id: pkg.recipientContextId, userId: actor.userId },
    });
    const snap = pkg.recipientSnapshot as Record<string, unknown>;
    if (r) {
      const current = recipientSnapshot(r);
      recipient = {
        email: r.email,
        name: r.name,
        verificationStatus: r.verificationStatus,
        changedSinceSnapshot: JSON.stringify(current) !== JSON.stringify(snap),
      };
    } else if (frozen && snap.id) {
      recipient = {
        email: (snap.email as string) ?? null,
        name: (snap.name as string) ?? null,
        verificationStatus: "STALE",
        changedSinceSnapshot: true,
      };
    }
  }

  return {
    frozen,
    input: {
      channel: pkg.channel as PackageChannel,
      includeEmail: pkg.includeEmail,
      includeCoverLetter: pkg.includeCoverLetter,
      frozen,
      candidate: { exists: Boolean(profile), usableFacts: facts.length },
      job: {
        exists: Boolean(job),
        deleted: Boolean(job?.deletedAt),
        contentHash: job?.contentHash ?? null,
        packagedContentHash: pkg.jobContentHash,
      },
      match: match
        ? { id: match.id, isCurrent: match.isCurrent, jobMatches: match.jobId === pkg.jobId }
        : null,
      requirementSet,
      research,
      assets,
      resumeVersionId: resumeRow?.resumeVersionId ?? null,
      recipient,
    },
  };
}

function integrityFor(pkg: {
  jobId: string;
  jobContentHash: string | null;
  channel: string;
  includeEmail: boolean;
  includeCoverLetter: boolean;
  matchId: string | null;
  requirementSetId: string | null;
  jobResearchId: string | null;
  candidateSnapshotHash: string | null;
  recipientSnapshot: unknown;
  strategySnapshot: unknown;
  assets: {
    assetType: string;
    resumeVersionId: string | null;
    communicationVersionId: string | null;
    contentHash: string;
  }[];
}) {
  return packageIntegrityHash({
    jobId: pkg.jobId,
    jobContentHash: pkg.jobContentHash,
    channel: pkg.channel as PackageChannel,
    includeEmail: pkg.includeEmail,
    includeCoverLetter: pkg.includeCoverLetter,
    matchId: pkg.matchId,
    requirementSetId: pkg.requirementSetId,
    jobResearchId: pkg.jobResearchId,
    candidateSnapshotHash: pkg.candidateSnapshotHash,
    assets: pkg.assets.map((a) => ({
      type: a.assetType as AssetType,
      versionId: (a.resumeVersionId ?? a.communicationVersionId)!,
      contentHash: a.contentHash,
    })),
    recipient: pkg.recipientSnapshot as Record<string, unknown>,
    strategy: pkg.strategySnapshot as Record<string, unknown>,
  });
}

/** Make sure every communication asset has a quality check for its exact content (cached). */
async function ensureChecks(
  actor: ActorRef,
  pkg: { assets: { communicationVersionId: string | null }[] },
) {
  for (const a of pkg.assets)
    if (a.communicationVersionId)
      await runCommunicationCheck(actor, a.communicationVersionId).catch(() => null);
}

/**
 * Deterministic readiness check. Editable packages first refresh their context references to the
 * current match / requirement set / research / job hash; frozen packages are only evaluated and move
 * forward to STALE / INVALID (never mutated). Records a check row and audits status transitions.
 */
export async function recheckPackage(
  actor: ActorRef,
  id: string,
): Promise<{ status: PackageStatus; evaluation: Evaluation; checkId: string }> {
  const initial = await withUserContext(actor.userId, (t) => ownedPackage(t, actor, id));
  if (initial.status === "ARCHIVED") {
    const last = await withUserContext(actor.userId, (t) =>
      t.communicationPackageCheck.findFirst({
        where: { packageId: id },
        orderBy: { createdAt: "desc" },
      }),
    );
    return {
      status: "ARCHIVED",
      evaluation: {
        items: (last?.items as unknown as Evaluation["items"]) ?? [],
        ready: false,
        staleReasons: [],
        invalidReasons: [],
      },
      checkId: last?.id ?? "",
    };
  }
  await ensureChecks(actor, initial);
  return withUserContext(actor.userId, async (t) => {
    let pkg = await ownedPackage(t, actor, id);
    const frozen = (FROZEN_STATUSES as readonly string[]).includes(pkg.status);
    if (!frozen) {
      const resumeVersionId =
        pkg.assets.find((a) => a.assetType === "RESUME")?.resumeVersionId ?? null;
      const { ctx, job } = await currentContext(t, actor, pkg.jobId, resumeVersionId);
      const rc = pkg.recipientContextId
        ? await t.recipientContext.findFirst({
            where: { id: pkg.recipientContextId, userId: actor.userId },
          })
        : null;
      await t.communicationPackage.update({
        where: { id: pkg.id },
        data: {
          matchId: ctx.match?.id ?? null,
          requirementSetId: ctx.requirementSetId,
          jobResearchId: ctx.jobResearchId,
          jobContentHash: job?.contentHash ?? null,
          candidateSnapshotHash: ctx.factsHash,
          recipientSnapshot: recipientSnapshot(rc) as Prisma.InputJsonValue,
          strategySnapshot: (await strategySnapshot(
            t,
            actor,
            pkg.assets.flatMap((a) => (a.communicationVersionId ? [a.communicationVersionId] : [])),
          )) as Prisma.InputJsonValue,
        },
      });
      pkg = await ownedPackage(t, actor, id);
    }
    const { input } = await buildEvaluationInput(t, actor, pkg);
    const evaluation = evaluatePackage(input);
    const status = nextStatus(pkg.status as PackageStatus, evaluation);
    const check = await t.communicationPackageCheck.create({
      data: {
        userId: actor.userId,
        packageId: pkg.id,
        result: evaluation.ready ? "READY" : "NOT_READY",
        items: evaluation.items as unknown as Prisma.InputJsonValue,
        integrityHash: integrityFor(pkg),
      },
    });
    if (status !== pkg.status) {
      await t.communicationPackage.update({
        where: { id: pkg.id },
        data: {
          status,
          ...(status === "STALE"
            ? {
                staleAt: new Date(),
                staleReasons: evaluation.staleReasons as Prisma.InputJsonValue,
              }
            : {}),
          ...(status === "INVALID"
            ? { invalidReason: evaluation.invalidReasons.join(" ").slice(0, 1000) }
            : {}),
        },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action:
          status === "STALE"
            ? "communication_package_stale"
            : status === "INVALID"
              ? "communication_package_invalid"
              : "communication_package_checked",
        resourceType: "communication_package",
        resourceId: pkg.id,
        metadata: {
          from: pkg.status,
          to: status,
          reasons: [...evaluation.staleReasons, ...evaluation.invalidReasons].slice(0, 5),
        },
      });
    }
    return { status, evaluation, checkId: check.id };
  });
}

// --- Commands ------------------------------------------------------------------------------------

export async function createPackage(
  actor: ActorRef,
  raw: PackageInput,
  previousPackageId: string | null = null,
) {
  const input = packageInput.parse(raw);
  const created = await withUserContext(actor.userId, async (t) => {
    const { ctx, job } = await currentContext(t, actor, input.jobId, input.resumeVersionId);
    if (!job || !ctx.job)
      throw new AppError("NOT_FOUND", {
        publicMessage: "The job was not found or is no longer available.",
      });
    const rows = await assetRows(t, actor, input.jobId, input);
    const rc = input.recipientContextId
      ? await t.recipientContext.findFirst({
          where: { id: input.recipientContextId, userId: actor.userId },
        })
      : null;
    if (input.recipientContextId && !rc)
      throw new AppError("NOT_FOUND", { publicMessage: "The recipient was not found." });
    const pkg = await t.communicationPackage.create({
      data: {
        userId: actor.userId,
        jobId: input.jobId,
        companyId: job.companyId,
        title: (input.title ?? `${job.title} — ${job.company.name}`).slice(0, 200),
        channel: input.channel,
        includeEmail: input.includeEmail,
        includeCoverLetter: input.includeCoverLetter,
        matchId: ctx.match?.id ?? null,
        requirementSetId: ctx.requirementSetId,
        jobResearchId: ctx.jobResearchId,
        jobContentHash: job.contentHash,
        candidateSnapshotHash: ctx.factsHash,
        recipientContextId: rc?.id ?? null,
        recipientSnapshot: recipientSnapshot(rc) as Prisma.InputJsonValue,
        strategySnapshot: (await strategySnapshot(
          t,
          actor,
          rows.flatMap((r) => (r.communicationVersionId ? [r.communicationVersionId] : [])),
        )) as Prisma.InputJsonValue,
        previousPackageId,
      },
    });
    if (rows.length)
      await t.communicationPackageAsset.createMany({
        data: rows.map((r) => ({ ...r, userId: actor.userId, packageId: pkg.id })),
      });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_package_created",
      resourceType: "communication_package",
      resourceId: pkg.id,
      metadata: {
        jobId: input.jobId,
        channel: input.channel,
        assets: rows.map((r) => r.assetType),
        previousPackageId,
      },
    });
    return pkg;
  });
  const check = await recheckPackage(actor, created.id);
  return { package: created, ...check };
}

/** Changes the selection of an editable package (never a frozen one). */
export async function updatePackage(actor: ActorRef, id: string, raw: Omit<PackageInput, "jobId">) {
  await withUserContext(actor.userId, async (t) => {
    const pkg = await ownedPackage(t, actor, id);
    if ((FROZEN_STATUSES as readonly string[]).includes(pkg.status))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage:
          "This package was ready for application and is locked. Duplicate it to prepare an updated package.",
      });
    const input = packageInput.parse({ ...raw, jobId: pkg.jobId });
    const rows = await assetRows(t, actor, pkg.jobId, input);
    const rc = input.recipientContextId
      ? await t.recipientContext.findFirst({
          where: { id: input.recipientContextId, userId: actor.userId },
        })
      : null;
    if (input.recipientContextId && !rc) throw new AppError("NOT_FOUND");
    await t.communicationPackageAsset.deleteMany({
      where: { packageId: pkg.id, userId: actor.userId },
    });
    if (rows.length)
      await t.communicationPackageAsset.createMany({
        data: rows.map((r) => ({ ...r, userId: actor.userId, packageId: pkg.id })),
      });
    await t.communicationPackage.update({
      where: { id: pkg.id },
      data: {
        channel: input.channel,
        includeEmail: input.includeEmail,
        includeCoverLetter: input.includeCoverLetter,
        recipientContextId: rc?.id ?? null,
        ...(input.title ? { title: input.title } : {}),
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_package_updated",
      resourceType: "communication_package",
      resourceId: pkg.id,
      metadata: { assets: rows.map((r) => r.assetType) },
    });
  });
  return recheckPackage(actor, id);
}

/**
 * The candidate confirms the final review: re-runs the readiness check, records the exact approval
 * ids and integrity hash, and freezes the package as READY_FOR_APPLICATION (prepared — not submitted).
 */
export async function markPackageReady(actor: ActorRef, id: string) {
  const check = await recheckPackage(actor, id);
  if (check.status === "READY_FOR_APPLICATION") return { status: check.status, created: false };
  if (check.status !== "READY_FOR_REVIEW") {
    const failing = check.evaluation.items.filter((i) => i.status === "FAIL").map((i) => i.detail);
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `Not ready: ${failing.slice(0, 3).join(" ")}`,
    });
  }
  return withUserContext(actor.userId, async (t) => {
    const pkg = await ownedPackage(t, actor, id);
    const { input } = await buildEvaluationInput(t, actor, pkg);
    const evaluation = evaluatePackage(input);
    if (!evaluation.ready)
      throw new AppError("CONFLICT", {
        publicMessage: "Something changed while confirming. Re-check the package.",
      });
    for (const a of pkg.assets) {
      const state = input.assets[a.assetType as AssetType];
      await t.communicationPackageAsset.update({
        where: { id: a.id },
        data: { approvalId: state?.activeApproval?.id ?? null },
      });
    }
    const integrityHash = integrityFor(pkg);
    await t.communicationPackage.update({
      where: { id: pkg.id },
      data: { status: "READY_FOR_APPLICATION", integrityHash, readyAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_package_ready",
      resourceType: "communication_package",
      resourceId: pkg.id,
      metadata: {
        integrityHash,
        assets: pkg.assets.map(
          (a) => `${a.assetType}:${a.resumeVersionId ?? a.communicationVersionId}:${a.contentHash}`,
        ),
      },
    });
    return { status: "READY_FOR_APPLICATION" as const, created: true };
  });
}

/**
 * Duplicate a package into a new editable package. `refresh` selects the latest approved version of
 * each asset (the explicit way to update a STALE package); otherwise the same versions are kept.
 */
export async function duplicatePackage(
  actor: ActorRef,
  id: string,
  opts: { refresh?: boolean } = {},
) {
  const source = await withUserContext(actor.userId, (t) => ownedPackage(t, actor, id));
  const pick = async (type: AssetType) => {
    const row = source.assets.find((a) => a.assetType === type);
    if (!row) return null;
    if (!opts.refresh) return row.resumeVersionId ?? row.communicationVersionId;
    return withUserContext(actor.userId, async (t) => {
      if (row.resumeVersionId) {
        const v = await t.resumeVersion.findUniqueOrThrow({ where: { id: row.resumeVersionId } });
        const latest = await t.resumeVersion.findFirst({
          where: { resumeId: v.resumeId, userId: actor.userId, status: "APPROVED" },
          orderBy: { versionNumber: "desc" },
        });
        return latest?.id ?? v.id;
      }
      const v = await t.communicationVersion.findUniqueOrThrow({
        where: { id: row.communicationVersionId! },
      });
      const latest = await t.communicationVersion.findFirst({
        where: { communicationId: v.communicationId, userId: actor.userId, status: "APPROVED" },
        orderBy: { versionNumber: "desc" },
      });
      return latest?.id ?? v.id;
    });
  };
  return createPackage(
    actor,
    {
      jobId: source.jobId,
      channel: source.channel as PackageChannel,
      includeEmail: source.includeEmail,
      includeCoverLetter: source.includeCoverLetter,
      resumeVersionId: await pick("RESUME"),
      emailVersionId: await pick("EMAIL"),
      coverLetterVersionId: await pick("COVER_LETTER"),
      recipientContextId: source.recipientContextId,
      title: source.title,
    },
    source.id,
  );
}

export async function archivePackage(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const pkg = await ownedPackage(t, actor, id);
    if (pkg.status === "ARCHIVED") return pkg;
    const updated = await t.communicationPackage.update({
      where: { id: pkg.id },
      data: { status: "ARCHIVED", archivedAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_package_archived",
      resourceType: "communication_package",
      resourceId: pkg.id,
      metadata: { from: pkg.status },
    });
    return updated;
  });
}

// --- Reads ---------------------------------------------------------------------------------------

export async function listPackages(
  actor: ActorRef,
  opts: { jobId?: string | null; status?: PackageStatus | null } = {},
) {
  return withUserContext(actor.userId, (t) =>
    t.communicationPackage.findMany({
      where: {
        userId: actor.userId,
        ...(opts.jobId ? { jobId: opts.jobId } : {}),
        ...(opts.status ? { status: opts.status } : { status: { not: "ARCHIVED" } }),
      },
      include: {
        job: { select: { id: true, title: true } },
        company: { select: { name: true } },
        assets: { select: { assetType: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
}

/** Package detail (runs the readiness/stale check first so the page never shows an outdated state). */
export async function getPackageView(actor: ActorRef, id: string) {
  const check = await recheckPackage(actor, id);
  return withUserContext(actor.userId, async (t) => {
    const pkg = await t.communicationPackage.findFirst({
      where: { id, userId: actor.userId },
      include: {
        job: { select: { id: true, title: true, deletedAt: true } },
        company: { select: { id: true, name: true } },
        match: { select: { id: true, overallStatus: true, computedAt: true, isCurrent: true } },
        jobResearch: { select: { id: true, version: true, isCurrent: true } },
        requirementSet: { select: { id: true, version: true, isCurrent: true } },
        recipientContext: true,
        previousPackage: { select: { id: true, title: true, status: true } },
        nextPackages: { select: { id: true, title: true, status: true, createdAt: true } },
        assets: {
          include: {
            resumeVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                resumeId: true,
                resume: { select: { name: true } },
              },
            },
            communicationVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                communicationId: true,
                contentSource: true,
                communication: { select: { title: true, communicationType: true } },
              },
            },
          },
        },
      },
    });
    if (!pkg) throw new AppError("NOT_FOUND");
    const assets = ASSET_TYPES.map((type) => pkg.assets.find((a) => a.assetType === type) ?? null);
    return {
      pkg,
      assets,
      evaluation: check.evaluation,
      required: requiredAssets(
        pkg.channel as PackageChannel,
        pkg.includeEmail,
        pkg.includeCoverLetter,
      ),
    };
  });
}

/** Approved versions the user can put into a package for a job (exact versions, newest first). */
export async function listPackageOptions(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    const resumes = await t.resumeVersion.findMany({
      where: {
        userId: actor.userId,
        status: "APPROVED",
        resume: { status: "ACTIVE" },
        OR: [{ targetJobId: jobId }, { targetJobId: null }],
      },
      select: {
        id: true,
        versionNumber: true,
        targetJobId: true,
        resume: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const comms = await t.communicationVersion.findMany({
      where: {
        userId: actor.userId,
        status: "APPROVED",
        communication: { jobId, status: "ACTIVE" },
      },
      select: {
        id: true,
        versionNumber: true,
        resumeVersionId: true,
        communication: {
          select: { title: true, kind: true, communicationType: true, recipientContextId: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const job = await t.job.findFirst({ where: { id: jobId }, select: { companyId: true } });
    const recipients = await t.recipientContext.findMany({
      where: {
        userId: actor.userId,
        verificationStatus: { notIn: ["INVALID", "STALE"] },
        ...(job ? { OR: [{ companyId: job.companyId }, { companyId: null }] } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });
    return {
      resumes: resumes
        .sort((a, b) => Number(b.targetJobId === jobId) - Number(a.targetJobId === jobId))
        .map((v) => ({
          value: v.id,
          label: `${v.resume.name} · v${v.versionNumber}${v.targetJobId === jobId ? " (tailored for this job)" : ""}`,
        })),
      emails: comms
        .filter((v) => v.communication.kind === "EMAIL")
        .map((v) => ({
          value: v.id,
          label: `${v.communication.title} · v${v.versionNumber}`,
          resumeVersionId: v.resumeVersionId,
          recipientContextId: v.communication.recipientContextId,
        })),
      coverLetters: comms
        .filter((v) => v.communication.kind === "COVER_LETTER")
        .map((v) => ({
          value: v.id,
          label: `${v.communication.title} · v${v.versionNumber}`,
          resumeVersionId: v.resumeVersionId,
        })),
      recipients: recipients.map((r) => ({
        value: r.id,
        label: `${r.name ?? r.email ?? r.title ?? r.company}${r.email ? ` <${r.email}>` : ""} · ${r.verificationStatus === "SOURCE_VERIFIED" ? "source verified" : "unverified"}`,
      })),
    };
  });
}

// --- Phase 8 handoff -----------------------------------------------------------------------------

export interface ApplicationHandoff {
  packageId: string;
  candidateId: string;
  jobId: string;
  channel: PackageChannel;
  matchVersionId: string | null;
  requirementSetId: string | null;
  researchVersionId: string | null;
  candidateSnapshotHash: string | null;
  resume: {
    versionId: string;
    contentHash: string;
    approvalStatus: "APPROVED";
    approvalId: string | null;
  };
  email: {
    versionId: string;
    contentHash: string;
    approvalStatus: "APPROVED";
    approvalId: string | null;
  } | null;
  coverLetter: {
    versionId: string;
    contentHash: string;
    approvalStatus: "APPROVED";
    approvalId: string | null;
  } | null;
  recipientContext: Record<string, unknown> | null;
  strategy: Record<string, unknown>;
  readinessStatus: "READY_FOR_APPLICATION";
  integrityStatus: "VERIFIED";
  integrityHash: string;
  readyAt: string;
  /** Explicit: prepared and approved assets — nothing has been submitted or sent. */
  submitted: false;
}

/**
 * The formal Phase 7 → Phase 8 boundary. Re-validates the package (stale/integrity) and returns the
 * exact approved asset versions ONLY for READY_FOR_APPLICATION packages whose integrity verifies.
 * Everything else is rejected — Phase 8 can never consume unapproved, stale or tampered assets.
 */
export async function getCommunicationPackageForApplication(
  actor: ActorRef,
  packageId: string,
): Promise<ApplicationHandoff> {
  const check = await recheckPackage(actor, packageId);
  const reject = (why: string) => {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `This package cannot be used for an application: ${why}`,
    });
  };
  if (check.status !== "READY_FOR_APPLICATION") {
    const reasons = check.evaluation.items.filter((i) => i.status === "FAIL").map((i) => i.detail);
    reject(
      `status is ${check.status.toLowerCase().replace(/_/g, " ")}${reasons.length ? ` (${reasons.slice(0, 3).join(" ")})` : ""}.`,
    );
  }
  return withUserContext(actor.userId, async (t) => {
    const pkg = await ownedPackage(t, actor, packageId);
    const profile = await getProfile(actor, t);
    if (!profile) reject("no candidate profile.");
    if (!pkg.integrityHash || integrityFor(pkg) !== pkg.integrityHash)
      reject("integrity check failed.");
    const asset = (type: AssetType) => {
      const a = pkg.assets.find((x) => x.assetType === type);
      return a
        ? {
            versionId: (a.resumeVersionId ?? a.communicationVersionId)!,
            contentHash: a.contentHash,
            approvalStatus: "APPROVED" as const,
            approvalId: a.approvalId,
          }
        : null;
    };
    const resume = asset("RESUME");
    if (!resume) reject("no resume.");
    const snap = pkg.recipientSnapshot as Record<string, unknown>;
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_package_handoff",
      resourceType: "communication_package",
      resourceId: pkg.id,
      metadata: { integrityHash: pkg.integrityHash },
    });
    return {
      packageId: pkg.id,
      candidateId: profile!.id,
      jobId: pkg.jobId,
      channel: pkg.channel as PackageChannel,
      matchVersionId: pkg.matchId,
      requirementSetId: pkg.requirementSetId,
      researchVersionId: pkg.jobResearchId,
      candidateSnapshotHash: pkg.candidateSnapshotHash,
      resume: resume!,
      email: asset("EMAIL"),
      coverLetter: asset("COVER_LETTER"),
      recipientContext: snap.id ? snap : null,
      strategy: pkg.strategySnapshot as Record<string, unknown>,
      readinessStatus: "READY_FOR_APPLICATION",
      integrityStatus: "VERIFIED",
      integrityHash: pkg.integrityHash!,
      readyAt: pkg.readyAt!.toISOString(),
      submitted: false,
    };
  });
}
