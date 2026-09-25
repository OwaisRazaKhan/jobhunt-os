import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { createFact, verifyFact, type ActorRef } from "./facts.service";
import { updateProfile } from "./profile.service";
import { sourceTypeForApproval } from "./provenance";
import { isSectionKind, profileUpdateInput } from "./schemas";

/**
 * Fact Review Center use cases. Extracted facts live in candidate_fact_candidates
 * until the user acts:
 *   - approve (individual, after reading it)  -> fact created, then VERIFIED
 *   - approve with edits                      -> edited fact created, then VERIFIED
 *   - bulk add (only "safe" candidates)       -> facts created as USER_PROVIDED (NOT verified)
 *   - reject                                  -> nothing is created
 */

export const BULK_MIN_CONFIDENCE = 0.6;

export interface BulkCheckable {
  status: string;
  category: string;
  confidence: number;
  duplicateOf: unknown;
}

/** Bulk approval is allowed only where nothing needs a human decision. */
export function bulkSafetyIssue(candidate: BulkCheckable): string | null {
  if (candidate.status !== "PENDING") return "Already reviewed";
  if (candidate.category === "profile")
    return "Profile fields replace existing values — review individually";
  if (candidate.duplicateOf) return "Possible duplicate — review individually";
  if (candidate.confidence < BULK_MIN_CONFIDENCE) return "Low confidence — review individually";
  return null;
}

async function loadPending(t: Tx, actor: ActorRef, candidateId: string) {
  const candidate = await t.candidateFactCandidate.findFirst({
    where: { id: candidateId, userId: actor.userId },
    include: { document: { select: { id: true, documentType: true } } },
  });
  if (!candidate) throw new AppError("NOT_FOUND");
  if (candidate.status !== "PENDING") {
    throw new AppError("CONFLICT", { publicMessage: "This fact has already been reviewed." });
  }
  return candidate;
}

export async function listPendingCandidates(actor: ActorRef, filter: { documentId?: string } = {}) {
  return withUserContext(actor.userId, (t) =>
    t.candidateFactCandidate.findMany({
      where: {
        userId: actor.userId,
        status: "PENDING",
        ...(filter.documentId ? { documentId: filter.documentId } : {}),
      },
      include: { document: { select: { id: true, fileName: true, documentType: true } } },
      orderBy: [{ documentId: "asc" }, { category: "asc" }, { createdAt: "asc" }],
    }),
  );
}

export async function countPendingCandidates(actor: ActorRef, tx?: Tx) {
  const run = (t: Tx) =>
    t.candidateFactCandidate.count({ where: { userId: actor.userId, status: "PENDING" } });
  return tx ? run(tx) : withUserContext(actor.userId, run);
}

export interface ApproveOptions {
  /** User-edited payload (from the edit form). Validated by the section schema. */
  editedPayload?: Record<string, unknown>;
  /** "verify" for individual review; "user_provided" for bulk add. */
  mode: "verify" | "user_provided";
}

async function approveInTx(t: Tx, actor: ActorRef, candidateId: string, options: ApproveOptions) {
  const candidate = await loadPending(t, actor, candidateId);
  const edited = options.editedPayload !== undefined;
  const payload = (options.editedPayload ?? candidate.payload) as Record<string, unknown>;
  let resultKind: string;
  let resultId: string | null = null;

  if (candidate.category === "profile") {
    const field = String((candidate.payload as Record<string, unknown>).field);
    const value = edited ? (payload.value ?? payload[field]) : payload.value;
    const parsed = profileUpdateInput.parse({ [field]: value });
    await updateProfile(actor, parsed, { auditAction: "fact_approved", tx: t });
    resultKind = "profile";
  } else if (isSectionKind(candidate.category)) {
    const record = await createFact(
      actor,
      candidate.category,
      payload,
      {
        verificationStatus: "USER_PROVIDED",
        sourceType: sourceTypeForApproval(candidate.document.documentType, candidate.method),
        sourceDocumentId: candidate.document.id,
        sourceFactCandidateId: candidate.id,
        sourceExcerpt: candidate.excerpt,
        confidence: candidate.confidence,
      },
      t,
    );
    // Individual approval IS the explicit user verification action.
    if (options.mode === "verify") await verifyFact(actor, candidate.category, record.id, t);
    resultKind = candidate.category;
    resultId = record.id;
  } else {
    throw new AppError("VALIDATION_ERROR", {
      message: `Unknown candidate category ${candidate.category}`,
    });
  }

  await t.candidateFactCandidate.update({
    where: { id: candidate.id },
    data: { status: "APPROVED", reviewedAt: new Date(), resultKind, resultId },
  });
  await recordAudit(t, {
    userId: actor.userId,
    action: edited ? "fact_edited" : "fact_approved",
    resourceType: "fact_candidate",
    resourceId: candidate.id,
    metadata: {
      category: candidate.category,
      method: candidate.method,
      verified: options.mode === "verify" && candidate.category !== "profile",
      resultKind,
    },
  });
  return { resultKind, resultId };
}

export async function approveCandidate(
  actor: ActorRef,
  candidateId: string,
  options: ApproveOptions,
) {
  return withUserContext(actor.userId, (t) => approveInTx(t, actor, candidateId, options));
}

export async function rejectCandidate(
  actor: ActorRef,
  candidateId: string,
  reason?: "duplicate" | "incorrect",
) {
  return withUserContext(actor.userId, async (t) => {
    const candidate = await loadPending(t, actor, candidateId);
    await t.candidateFactCandidate.update({
      where: { id: candidate.id },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "fact_rejected",
      resourceType: "fact_candidate",
      resourceId: candidate.id,
      metadata: { category: candidate.category, reason: reason ?? null },
    });
  });
}

export interface BulkResult {
  approved: string[];
  skipped: { id: string; reason: string }[];
}

/**
 * Adds the selected, safe candidates as USER_PROVIDED facts. Never marks
 * anything VERIFIED — the UI states this explicitly before confirming.
 */
export async function bulkApproveCandidates(
  actor: ActorRef,
  candidateIds: string[],
): Promise<BulkResult> {
  const result: BulkResult = { approved: [], skipped: [] };
  const ids = Array.from(new Set(candidateIds)).slice(0, 200);
  const candidates = await withUserContext(actor.userId, (t) =>
    t.candidateFactCandidate.findMany({ where: { id: { in: ids }, userId: actor.userId } }),
  );
  const found = new Set(candidates.map((c) => c.id));
  for (const id of ids) if (!found.has(id)) result.skipped.push({ id, reason: "Not found" });

  for (const candidate of candidates) {
    const issue = bulkSafetyIssue(candidate);
    if (issue) {
      result.skipped.push({ id: candidate.id, reason: issue });
      continue;
    }
    try {
      await approveCandidate(actor, candidate.id, { mode: "user_provided" });
      result.approved.push(candidate.id);
    } catch (error) {
      const reason = error instanceof AppError ? error.publicMessage : "Could not be added";
      result.skipped.push({ id: candidate.id, reason });
    }
  }
  return result;
}

export async function bulkRejectCandidates(actor: ActorRef, candidateIds: string[]) {
  let rejected = 0;
  for (const id of Array.from(new Set(candidateIds)).slice(0, 200)) {
    try {
      await rejectCandidate(actor, id);
      rejected++;
    } catch {
      // already reviewed or not owned — skip silently
    }
  }
  return { rejected };
}
