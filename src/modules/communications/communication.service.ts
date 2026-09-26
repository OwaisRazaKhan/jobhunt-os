import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { createFact } from "@/modules/candidate/facts.service";
import { getProfile } from "@/modules/candidate/profile.service";
import { loadUsableFacts } from "@/modules/resumes/resume.service";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { uuidv7 } from "@/lib/ids";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  communicationDocumentSchema,
  parseCommunicationDocument,
  toPlainText,
  type CommunicationDocument,
} from "./document";
import { auditDocument, corpusFingerprint, type AuditedClaim, type DeclaredClaim } from "./claims";
import { loadEvidence } from "./context.service";
import { diffCommunications, summarizeCommunicationDiff } from "./diff";
import { parseImportedText } from "./import";
import { communicationContentHash, contextHash } from "./hash";
import { QUALITY_CHECKER_VERSION, runQualityChecks, summarizeQuality } from "./quality";
import {
  COMMUNICATION_TYPES,
  COVER_LETTER_TEMPLATES,
  defaultGreeting,
  PURPOSE_BY_TYPE,
  kindOf,
  LENGTHS,
  RECIPIENT_TYPES,
  TONES,
  type CommunicationType,
  type ContentSource,
  type VersionStatus,
  type VersionType,
} from "./types";

/**
 * Communication Studio service (Phase 7). Rules:
 *  - communications are user-owned (service filters by userId; RLS enforces the same)
 *  - the head version is edited in place only while DRAFT; any other state → new version
 *  - APPROVED content is immutable (DB trigger); approval binds the exact content hash
 *  - every version locks its context: resume version, job requirement set, research, match
 *  - nothing is ever sent — Phase 7 has no delivery channel
 */

export type ActorRef = { userId: string };

const optText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullable().default(null),
  );

const refList = z.preprocess(
  (v) => (typeof v === "string" ? (v ? [v] : []) : v),
  z.array(z.string().regex(/^[a-z]+:[0-9a-f-]{36}$/)).max(12),
);

export const communicationSettingsInput = z.object({
  requestedAction: optText(300).optional(),
  primaryEvidence: refList.optional(),
  secondaryEvidence: refList.optional(),
  title: z.string().trim().min(1, "Enter a title").max(200).optional(),
  recipientType: z.enum(RECIPIENT_TYPES).optional(),
  recipientName: optText(200).optional(),
  recipientTitle: optText(200).optional(),
  recipientCompany: optText(200).optional(),
  recipientEmail: z
    .preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? null : v),
      z.string().trim().max(254).email("Enter a valid email").nullable(),
    )
    .optional(),
  recipientSource: optText(500).optional(),
  tone: z.enum(TONES).optional(),
  length: z.enum(LENGTHS).optional(),
  template: z.string().max(40).optional(),
  pageFormat: z.enum(["A4", "LETTER"]).optional(),
  userContext: optText(2000).optional(),
  signaturePresetId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).optional(),
});

export const createCommunicationInput = communicationSettingsInput.extend({
  communicationType: z.enum(COMMUNICATION_TYPES),
  jobId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
  resumeVersionId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
  recipientContextId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()).default(null),
});
export type CreateCommunicationInput = z.input<typeof createCommunicationInput>;

// --- Context ------------------------------------------------------------------------

export interface CommunicationContext {
  job: { id: string; title: string; companyId: string; companyName: string } | null;
  requirementSetId: string | null;
  jobResearchId: string | null;
  jobResearchVersion: number | null;
  match: { id: string; overallStatus: string; computedAt: Date } | null;
  resumeVersion: {
    id: string;
    resumeId: string;
    versionNumber: number;
    status: string;
    resumeName: string;
  } | null;
  factsHash: string;
  candidateName: string | null;
}

/** Loads (and validates access to) the job, resume version and the CURRENT research/match. */
export async function captureContext(
  t: Tx,
  actor: ActorRef,
  jobId: string | null,
  resumeVersionId: string | null,
): Promise<CommunicationContext> {
  let job: CommunicationContext["job"] = null;
  let requirementSetId: string | null = null;
  let research: { id: string; version: number } | null = null;
  let match: CommunicationContext["match"] = null;
  if (jobId) {
    const row = await t.job.findFirst({
      where: {
        id: jobId,
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      select: { id: true, title: true, companyId: true, company: { select: { name: true } } },
    });
    if (!row)
      throw new AppError("NOT_FOUND", {
        publicMessage: "The job was not found or is no longer available.",
      });
    job = { id: row.id, title: row.title, companyId: row.companyId, companyName: row.company.name };
    requirementSetId =
      (
        await t.jobRequirementSet.findFirst({
          where: { jobId, isCurrent: true },
          select: { id: true },
        })
      )?.id ?? null;
    research = await t.jobResearch.findFirst({
      where: { userId: actor.userId, jobId, isCurrent: true },
      select: { id: true, version: true },
    });
    match = await t.jobMatch.findFirst({
      where: { userId: actor.userId, jobId, isCurrent: true },
      select: { id: true, overallStatus: true, computedAt: true },
      orderBy: { computedAt: "desc" },
    });
  }
  let resumeVersion: CommunicationContext["resumeVersion"] = null;
  if (resumeVersionId) {
    const v = await t.resumeVersion.findFirst({
      where: { id: resumeVersionId, userId: actor.userId },
      select: {
        id: true,
        resumeId: true,
        versionNumber: true,
        status: true,
        resume: { select: { name: true } },
      },
    });
    if (!v)
      throw new AppError("NOT_FOUND", {
        publicMessage: "The selected resume version was not found.",
      });
    resumeVersion = {
      id: v.id,
      resumeId: v.resumeId,
      versionNumber: v.versionNumber,
      status: v.status,
      resumeName: v.resume.name,
    };
  }
  const facts = await loadUsableFacts(actor, t);
  const profile = await getProfile(actor, t);
  return {
    job,
    requirementSetId,
    jobResearchId: research?.id ?? null,
    jobResearchVersion: research?.version ?? null,
    match,
    resumeVersion,
    factsHash: sha256Hex(JSON.stringify(facts.map((f) => [f.ref, f.value]).sort())),
    candidateName: profile?.fullName ?? null,
  };
}

// --- Signatures ---------------------------------------------------------------------

export const SIGNATURE_FIELDS = [
  "name",
  "email",
  "phone",
  "location",
  "linkedin",
  "portfolio",
  "website",
] as const;
export type SignatureFields = Partial<Record<(typeof SIGNATURE_FIELDS)[number], string | null>>;

export function signatureText(fields: SignatureFields): string {
  return SIGNATURE_FIELDS.map((k) => fields[k]?.trim())
    .filter(Boolean)
    .join("\n");
}

async function defaultSignature(t: Tx, actor: ActorRef, presetId: string | null): Promise<string> {
  const preset = presetId
    ? await t.signaturePreset.findFirst({ where: { id: presetId, userId: actor.userId } })
    : await t.signaturePreset.findFirst({ where: { userId: actor.userId, isDefault: true } });
  if (preset) return signatureText(preset.fields as SignatureFields);
  // No preset: name only (the user decides which contact details appear).
  const profile = await getProfile(actor, t);
  return profile?.fullName ?? "";
}

// --- Persistence helpers ------------------------------------------------------------

async function nextVersionNumber(t: Tx, communicationId: string) {
  const last = await t.communicationVersion.findFirst({
    where: { communicationId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (last?.versionNumber ?? 0) + 1;
}

export interface NewVersionInput {
  communicationId: string;
  doc: CommunicationDocument;
  versionType: VersionType;
  contentSource: ContentSource;
  parentId?: string | null;
  context: Pick<
    CommunicationContext,
    "requirementSetId" | "jobResearchId" | "match" | "resumeVersion" | "factsHash"
  >;
  contextParts?: Record<string, unknown>;
  generation?: Record<string, unknown>;
}

export async function insertVersion(t: Tx, actor: ActorRef, input: NewVersionInput) {
  const doc = parseCommunicationDocument(input.doc);
  const version = await t.communicationVersion.create({
    data: {
      userId: actor.userId,
      communicationId: input.communicationId,
      versionNumber: await nextVersionNumber(t, input.communicationId),
      parentVersionId: input.parentId ?? null,
      versionType: input.versionType,
      contentSource: input.contentSource,
      status: "DRAFT",
      content: doc as unknown as Prisma.InputJsonValue,
      plainText: toPlainText(doc),
      contentHash: communicationContentHash(doc),
      resumeVersionId: input.context.resumeVersion?.id ?? null,
      requirementSetId: input.context.requirementSetId,
      jobResearchId: input.context.jobResearchId,
      matchId: input.context.match?.id ?? null,
      contextHash: contextHash({
        facts: input.context.factsHash,
        requirementSet: input.context.requirementSetId,
        research: input.context.jobResearchId,
        match: input.context.match?.id ?? null,
        resume: input.context.resumeVersion?.id ?? null,
        ...(input.contextParts ?? {}),
      }),
      generation: (input.generation ?? {}) as Prisma.InputJsonValue,
    },
  });
  await t.communication.update({
    where: { id: input.communicationId },
    data: { currentVersionId: version.id },
  });
  return version;
}

async function ownedCommunication(t: Tx, actor: ActorRef, id: string) {
  const c = await t.communication.findFirst({ where: { id, userId: actor.userId } });
  if (!c) throw new AppError("NOT_FOUND");
  return c;
}

async function ownedVersion(t: Tx, actor: ActorRef, id: string) {
  const v = await t.communicationVersion.findFirst({
    where: { id, userId: actor.userId },
    include: { communication: true },
  });
  if (!v) throw new AppError("NOT_FOUND");
  return v;
}

function assertActive(c: { status: string }) {
  if (c.status === "ARCHIVED")
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "This communication is archived. Restore it to make changes.",
    });
}

/** Evidence for a version, loaded for the exact versions it is locked to. */
export async function evidenceForVersion(
  t: Tx,
  actor: ActorRef,
  version: {
    resumeVersionId: string | null;
    requirementSetId: string | null;
    jobResearchId: string | null;
    matchId: string | null;
  },
  c: {
    jobId: string | null;
    userContext: string | null;
    recipientName: string | null;
    recipientTitle: string | null;
    recipientCompany: string | null;
  },
) {
  return loadEvidence(t, actor, {
    jobId: c.jobId,
    resumeVersionId: version.resumeVersionId,
    requirementSetId: version.requirementSetId,
    jobResearchId: version.jobResearchId,
    matchId: version.matchId,
    userContext: c.userContext,
    recipient: { name: c.recipientName, title: c.recipientTitle, company: c.recipientCompany },
  });
}

const FACT_REF = /^[a-z]+:[0-9a-f-]{36}$/;

type ClaimRow = {
  location: string;
  text: string;
  claimKind: string;
  status: string;
  reasons: Prisma.InputJsonValue;
  sources: { sourceKind: string; factRef?: string | null; researchClaimId?: string | null }[];
};

/** Batched insert (3 round trips regardless of the number of claims). */
async function insertClaimRows(t: Tx, actor: ActorRef, versionId: string, rows: ClaimRow[]) {
  if (!rows.length) return;
  const withIds = rows.map((r) => ({ ...r, id: uuidv7() }));
  await t.communicationClaim.createMany({
    data: withIds.map((r) => ({
      id: r.id,
      userId: actor.userId,
      versionId,
      location: r.location.slice(0, 40),
      text: r.text.slice(0, 2000),
      claimKind: r.claimKind,
      status: r.status,
      reasons: r.reasons,
    })),
  });
  const sources = withIds.flatMap((r) =>
    r.sources.map((src) => ({
      userId: actor.userId,
      claimId: r.id,
      sourceKind: src.sourceKind,
      factRef: src.factRef ?? null,
      researchClaimId: src.researchClaimId ?? null,
    })),
  );
  if (sources.length) await t.communicationClaimSource.createMany({ data: sources });
}

/** Replaces a version's claims (with their evidence links). */
export async function persistClaims(
  t: Tx,
  actor: ActorRef,
  versionId: string,
  claims: AuditedClaim[],
) {
  await t.communicationClaim.deleteMany({ where: { versionId, userId: actor.userId } });
  await insertClaimRows(
    t,
    actor,
    versionId,
    claims.map((c) => ({
      location: c.location,
      text: c.text,
      claimKind: c.claimKind,
      status: c.status,
      reasons: { reasons: c.reasons, basis: c.basis, unsupported: c.unsupported },
      sources: [
        ...c.factRefs
          .filter((r) => FACT_REF.test(r))
          .map((factRef) => ({ sourceKind: "CANDIDATE_FACT", factRef })),
        ...c.researchClaimIds.map((researchClaimId) => ({
          sourceKind: "RESEARCH_CLAIM",
          researchClaimId,
        })),
        ...(c.userContext ? [{ sourceKind: "USER_CONTEXT" }] : []),
      ],
    })),
  );
}

async function declaredFromClaims(
  t: Tx,
  actor: ActorRef,
  versionId: string,
): Promise<DeclaredClaim[]> {
  const rows = await t.communicationClaim.findMany({
    where: { versionId, userId: actor.userId },
    include: { sources: true },
  });
  return rows.map((r) => ({
    text: r.text,
    factRefs: r.sources.flatMap((s) => (s.factRef ? [s.factRef] : [])),
    researchClaimIds: r.sources.flatMap((s) => (s.researchClaimId ? [s.researchClaimId] : [])),
    usesUserContext: r.sources.some((s) => s.sourceKind === "USER_CONTEXT"),
  }));
}

/** Carries claim provenance (citations) to a new version; the next check re-audits it. */
async function copyClaims(t: Tx, actor: ActorRef, fromVersionId: string, toVersionId: string) {
  const rows = await t.communicationClaim.findMany({
    where: { versionId: fromVersionId, userId: actor.userId },
    include: { sources: true },
  });
  await insertClaimRows(
    t,
    actor,
    toVersionId,
    rows.map((r) => ({
      location: r.location,
      text: r.text,
      claimKind: r.claimKind,
      status: r.status,
      reasons: r.reasons as Prisma.InputJsonValue,
      sources: r.sources,
    })),
  );
}

// --- Create --------------------------------------------------------------------------

/** Starting document: structure only (no generic copy), greeting never invents a name. */
export function starterDocument(input: {
  type: (typeof COMMUNICATION_TYPES)[number];
  jobTitle: string | null;
  companyName: string | null;
  recipientName: string | null;
  recipientType: (typeof RECIPIENT_TYPES)[number];
  signature: string;
  header?: { name: string | null; email: string | null; phone: string | null };
  preferredGreeting?: string | null;
  preferredClosing?: string | null;
}): CommunicationDocument {
  const greeting = defaultGreeting(
    input.recipientName,
    input.recipientType,
    input.preferredGreeting,
  );
  const closing = input.preferredClosing?.trim() || "Kind regards,";
  if (kindOf(input.type) === "COVER_LETTER") {
    return parseCommunicationDocument({
      kind: "COVER_LETTER",
      header: {
        name: input.header?.name ?? null,
        email: input.header?.email ?? null,
        phone: input.header?.phone ?? null,
        location: null,
        links: [],
      },
      date: null,
      recipient: { name: input.recipientName, title: null, company: input.companyName },
      greeting,
      paragraphs: [],
      closing,
      signature: input.signature,
    });
  }
  const subject =
    input.type === "APPLICATION_EMAIL" && input.jobTitle
      ? `Application — ${input.jobTitle}`
      : input.jobTitle
        ? `Regarding the ${input.jobTitle} role`
        : "";
  return parseCommunicationDocument({
    kind: "EMAIL",
    subject,
    greeting,
    bodyParagraphs: [],
    closing,
    signature: input.signature,
  });
}

export async function createCommunication(
  actor: ActorRef,
  raw: CreateCommunicationInput,
  initial?: { importedText: string },
) {
  const input = createCommunicationInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const ctx = await captureContext(t, actor, input.jobId, input.resumeVersionId);
    const kind = kindOf(input.communicationType);
    const template =
      kind === "COVER_LETTER"
        ? (COVER_LETTER_TEMPLATES as readonly string[]).includes(input.template ?? "")
          ? input.template!
          : "CLASSIC"
        : "APPLICATION";
    const recipientType = input.recipientType ?? "UNKNOWN";
    const signature = await defaultSignature(t, actor, input.signaturePresetId ?? null);
    const profile = kind === "COVER_LETTER" ? await getProfile(actor, t) : null;
    const prefs = await t.communicationPreference.findUnique({ where: { userId: actor.userId } });
    // A saved recipient context fills the recipient fields (nothing is guessed).
    const recipient = input.recipientContextId
      ? await t.recipientContext.findFirst({
          where: { id: input.recipientContextId, userId: actor.userId },
        })
      : null;
    if (input.recipientContextId && !recipient)
      throw new AppError("NOT_FOUND", { publicMessage: "The selected recipient was not found." });
    if (recipient) {
      input.recipientType = recipient.recipientType as (typeof RECIPIENT_TYPES)[number];
      input.recipientName = recipient.name;
      input.recipientTitle = recipient.title;
      input.recipientCompany = recipient.company ?? input.recipientCompany ?? null;
      input.recipientEmail = recipient.email;
      input.recipientSource = recipient.sourceUrl ?? recipient.source;
    }
    const communication = await t.communication.create({
      data: {
        userId: actor.userId,
        kind,
        communicationType: input.communicationType,
        title: (
          input.title ??
          (ctx.job
            ? `${ctx.job.title} — ${ctx.job.companyName}`
            : kind === "EMAIL"
              ? "New email"
              : "New cover letter")
        ).slice(0, 200),
        jobId: ctx.job?.id ?? null,
        companyId: ctx.job?.companyId ?? null,
        resumeVersionId: ctx.resumeVersion?.id ?? null,
        recipientType,
        recipientName: input.recipientName ?? null,
        recipientTitle: input.recipientTitle ?? null,
        recipientCompany: input.recipientCompany ?? ctx.job?.companyName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        recipientSource: input.recipientSource ?? null,
        tone: input.tone ?? prefs?.defaultTone ?? "NATURAL",
        length: input.length ?? prefs?.defaultLength ?? "STANDARD",
        recipientContextId: recipient?.id ?? null,
        strategy: {
          purpose: PURPOSE_BY_TYPE[input.communicationType],
          ...(input.requestedAction ? { requestedAction: input.requestedAction } : {}),
        } as Prisma.InputJsonValue,
        template,
        pageFormat: input.pageFormat ?? "A4",
        userContext: input.userContext ?? null,
        signaturePresetId: input.signaturePresetId ?? null,
      },
    });
    const starter = starterDocument({
      type: input.communicationType,
      jobTitle: ctx.job?.title ?? null,
      companyName: ctx.job?.companyName ?? null,
      recipientName: input.recipientName ?? null,
      recipientType,
      signature,
      header: profile
        ? {
            name: profile.fullName ?? null,
            email: profile.professionalEmail ?? null,
            phone: profile.phone ?? null,
          }
        : undefined,
      preferredGreeting: prefs?.preferredGreeting,
      preferredClosing: prefs?.preferredClosing,
    });
    // Imported text is data: reduced to plain text and structured, header/recipient from facts.
    const doc = initial
      ? (() => {
          const parsed = parseImportedText(initial.importedText, kind, {
            greeting: starter.greeting,
            signature,
            subject: starter.kind === "EMAIL" ? starter.subject : undefined,
          });
          return parsed.kind === "COVER_LETTER" && starter.kind === "COVER_LETTER"
            ? parseCommunicationDocument({
                ...parsed,
                header: starter.header,
                recipient: starter.recipient,
              })
            : parsed;
        })()
      : starter;
    await insertVersion(t, actor, {
      communicationId: communication.id,
      doc,
      versionType: initial ? "IMPORTED" : "MANUAL_EDIT",
      contentSource: initial ? "IMPORTED" : "USER_AUTHORED",
      context: ctx,
      generation: { method: initial ? "IMPORT" : "MANUAL" },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: initial ? "communication_imported" : "communication_created",
      resourceType: "communication",
      resourceId: communication.id,
      metadata: { kind, type: input.communicationType, jobId: ctx.job?.id ?? null },
    });
    return ownedCommunication(t, actor, communication.id);
  });
}

// --- Read ------------------------------------------------------------------------------

export const LIST_FILTERS = [
  "all",
  "emails",
  "cover-letters",
  "drafts",
  "review",
  "approved",
  "archived",
] as const;
export type ListFilter = (typeof LIST_FILTERS)[number];

export async function listCommunications(actor: ActorRef, filter: ListFilter = "all") {
  const where: Prisma.CommunicationWhereInput = { userId: actor.userId };
  if (filter === "archived") where.status = "ARCHIVED";
  else {
    where.status = "ACTIVE";
    if (filter === "emails") where.kind = "EMAIL";
    if (filter === "cover-letters") where.kind = "COVER_LETTER";
    if (filter === "drafts") where.currentVersion = { status: "DRAFT" };
    if (filter === "review") where.currentVersion = { status: "READY_FOR_REVIEW" };
    if (filter === "approved") where.currentVersion = { status: "APPROVED" };
  }
  return withUserContext(actor.userId, (t) =>
    t.communication.findMany({
      where,
      include: {
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            contentSource: true,
            updatedAt: true,
            generation: true,
          },
        },
        job: { select: { id: true, title: true } },
        company: { select: { name: true } },
        _count: { select: { versions: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
}

export async function getCommunicationWorkspace(
  actor: ActorRef,
  id: string,
  versionId?: string | null,
) {
  return withUserContext(actor.userId, async (t) => {
    const communication = await t.communication.findFirst({
      where: { id, userId: actor.userId },
      include: {
        job: { select: { id: true, title: true, deletedAt: true } },
        company: { select: { id: true, name: true } },
        resumeVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            resume: { select: { id: true, name: true } },
          },
        },
        versions: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            versionType: true,
            contentSource: true,
            contentHash: true,
            createdAt: true,
            updatedAt: true,
            parentVersionId: true,
            generation: true,
            approvals: { where: { revokedAt: null }, select: { id: true, approvedAt: true } },
          },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
    if (!communication) throw new AppError("NOT_FOUND");
    const selected = versionId ?? communication.currentVersionId;
    const version = selected
      ? await t.communicationVersion.findFirst({
          where: { id: selected, communicationId: communication.id, userId: actor.userId },
          include: {
            claims: { include: { sources: true }, orderBy: { location: "asc" } },
            jobResearch: { select: { id: true, version: true } },
            requirementSet: { select: { id: true, version: true } },
            match: { select: { id: true, overallStatus: true, computedAt: true } },
            resumeVersion: {
              select: {
                id: true,
                versionNumber: true,
                status: true,
                resume: { select: { id: true, name: true } },
              },
            },
          },
        })
      : null;
    if (versionId && !version) throw new AppError("NOT_FOUND");
    const [latestCheck, approvals, exports] = version
      ? [
          await t.communicationCheck.findFirst({
            where: { versionId: version.id, userId: actor.userId },
            include: { findings: true },
            orderBy: { createdAt: "desc" },
          }),
          await t.communicationApproval.findMany({
            where: { versionId: version.id, userId: actor.userId },
            orderBy: { approvedAt: "desc" },
          }),
          await t.communicationExport.findMany({
            where: { versionId: version.id, userId: actor.userId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
        ]
      : [null, [], []];
    return {
      communication,
      version,
      doc: version ? parseCommunicationDocument(version.content) : null,
      latestCheck,
      approvals,
      exports,
      isHead: version?.id === communication.currentVersionId,
    };
  });
}

// --- Edit --------------------------------------------------------------------------------

/**
 * Saves editor content with optimistic concurrency (`expectedHash`). DRAFT heads are updated in
 * place (claims are re-audited by the next check); any other state creates a
 * new MANUAL_EDIT version, so approved content never changes and approval never carries over.
 */
export async function saveCommunicationContent(
  actor: ActorRef,
  id: string,
  input: { content: unknown; expectedHash: string },
) {
  const parsed = communicationDocumentSchema.safeParse(input.content);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Some fields are invalid.",
      details: parsed.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return withUserContext(actor.userId, async (t) => {
    const communication = await ownedCommunication(t, actor, id);
    assertActive(communication);
    const head = communication.currentVersionId
      ? await t.communicationVersion.findUnique({ where: { id: communication.currentVersionId } })
      : null;
    if (!head) throw new AppError("NOT_FOUND");
    if (parsed.data.kind !== communication.kind)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The content type does not match this communication.",
      });
    if (head.contentHash !== input.expectedHash) {
      throw new AppError("CONFLICT", {
        publicMessage:
          "This communication changed elsewhere (another tab or action). Reload — your edits were not saved.",
      });
    }
    const hash = communicationContentHash(parsed.data);
    if (hash === head.contentHash) return { version: head, created: false, unchanged: true };
    const editedSource: ContentSource =
      head.contentSource === "AI_GENERATED" || head.contentSource === "AI_ASSISTED"
        ? "AI_ASSISTED"
        : head.contentSource === "IMPORTED"
          ? "IMPORTED"
          : "USER_AUTHORED";

    if (head.status === "DRAFT") {
      const version = await t.communicationVersion.update({
        where: { id: head.id },
        data: {
          content: parsed.data as unknown as Prisma.InputJsonValue,
          plainText: toPlainText(parsed.data),
          contentHash: hash,
          contentSource: editedSource,
        },
      });
      await t.communication.update({
        where: { id: communication.id },
        data: { updatedAt: new Date() },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "communication_edited",
        resourceType: "communication_version",
        resourceId: version.id,
        metadata: { communicationId: communication.id },
      });
      return { version, created: false, unchanged: false };
    }
    const version = await insertVersion(t, actor, {
      communicationId: communication.id,
      doc: parsed.data,
      versionType: "MANUAL_EDIT",
      contentSource: editedSource,
      parentId: head.id,
      context: {
        requirementSetId: head.requirementSetId,
        jobResearchId: head.jobResearchId,
        match: head.matchId
          ? { id: head.matchId, overallStatus: "", computedAt: new Date(0) }
          : null,
        resumeVersion: head.resumeVersionId
          ? { id: head.resumeVersionId, resumeId: "", versionNumber: 0, status: "", resumeName: "" }
          : null,
        factsHash: "",
      },
      generation: { method: "MANUAL_EDIT", from: head.id, supersedes: head.status },
    });
    await copyClaims(t, actor, head.id, version.id);
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_version_created",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: { communicationId: communication.id, from: head.id, fromStatus: head.status },
    });
    return { version, created: true, unchanged: false };
  });
}

export async function updateCommunicationSettings(actor: ActorRef, id: string, raw: unknown) {
  const input = communicationSettingsInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const communication = await ownedCommunication(t, actor, id);
    if (
      input.template !== undefined &&
      communication.kind === "COVER_LETTER" &&
      !(COVER_LETTER_TEMPLATES as readonly string[]).includes(input.template)
    ) {
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "template", message: "Unknown template" }],
      });
    }
    if (input.signaturePresetId) {
      const preset = await t.signaturePreset.findFirst({
        where: { id: input.signaturePresetId, userId: actor.userId },
      });
      if (!preset) throw new AppError("NOT_FOUND");
    }
    const { requestedAction, primaryEvidence, secondaryEvidence, ...columns } = input;
    const data: Record<string, unknown> = Object.fromEntries(
      Object.entries(columns).filter(([, v]) => v !== undefined),
    );
    if (
      requestedAction !== undefined ||
      primaryEvidence !== undefined ||
      secondaryEvidence !== undefined
    ) {
      const current = (communication.strategy ?? {}) as Record<string, unknown>;
      data.strategy = {
        ...current,
        purpose:
          current.purpose ?? PURPOSE_BY_TYPE[communication.communicationType as CommunicationType],
        ...(requestedAction !== undefined ? { requestedAction } : {}),
        ...(primaryEvidence !== undefined ? { primaryEvidence } : {}),
        ...(secondaryEvidence !== undefined ? { secondaryEvidence } : {}),
      };
    }
    // Editing recipient fields by hand detaches the saved recipient context (it no longer mirrors it).
    if (
      ["recipientName", "recipientEmail", "recipientTitle"].some(
        (k) => k in data && data[k] !== (communication as Record<string, unknown>)[k],
      )
    )
      data.recipientContextId = null;
    const updated = await t.communication.update({ where: { id: communication.id }, data });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_edited",
      resourceType: "communication",
      resourceId: communication.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });
}

export async function restoreCommunicationVersion(actor: ActorRef, versionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await ownedVersion(t, actor, versionId);
    assertActive(source.communication);
    const head = source.communication.currentVersionId
      ? await t.communicationVersion.findUnique({
          where: { id: source.communication.currentVersionId },
        })
      : null;
    // Idempotent: restoring onto an identical draft head does nothing.
    if (
      head &&
      head.status === "DRAFT" &&
      head.contentHash === source.contentHash &&
      head.versionType === "RESTORED"
    )
      return head;
    const version = await insertVersion(t, actor, {
      communicationId: source.communicationId,
      doc: parseCommunicationDocument(source.content),
      versionType: "RESTORED",
      contentSource: "RESTORED",
      parentId: head?.id ?? null,
      context: {
        requirementSetId: source.requirementSetId,
        jobResearchId: source.jobResearchId,
        match: source.matchId
          ? { id: source.matchId, overallStatus: "", computedAt: new Date(0) }
          : null,
        resumeVersion: source.resumeVersionId
          ? {
              id: source.resumeVersionId,
              resumeId: "",
              versionNumber: 0,
              status: "",
              resumeName: "",
            }
          : null,
        factsHash: "",
      },
      generation: { method: "RESTORE", from: source.id },
    });
    await copyClaims(t, actor, source.id, version.id);
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_restored",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: { from: source.id },
    });
    return version;
  });
}

// --- Checks ---------------------------------------------------------------------------------

/**
 * Quality check for the exact content: re-audits every statement against the version's locked
 * evidence (claims are replaced), then runs the deterministic quality engine. A check is reused
 * only while the content AND the evidence are unchanged.
 */
export async function runCommunicationCheck(
  actor: ActorRef,
  versionId: string,
  opts: { force?: boolean } = {},
) {
  // 1. Read (evidence for the locked context, latest check, current citations).
  const read = await withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    const evidence = await evidenceForVersion(t, actor, version, version.communication);
    const prefs = await t.communicationPreference.findUnique({ where: { userId: actor.userId } });
    const avoidPhrases = prefs?.avoidPhrases ?? [];
    const evidenceHash = sha256Hex(
      corpusFingerprint(evidence.corpus) + JSON.stringify(avoidPhrases),
    );
    const latest = await t.communicationCheck.findFirst({
      where: { versionId: version.id, userId: actor.userId },
      include: { findings: true },
      orderBy: { createdAt: "desc" },
    });
    const declared = await declaredFromClaims(t, actor, version.id);
    return { version, evidence, evidenceHash, latest, declared, avoidPhrases };
  });
  const { version, evidence, evidenceHash, latest } = read;
  const c = version.communication;
  if (
    !opts.force &&
    latest &&
    latest.contentHash === version.contentHash &&
    latest.checkerVersion === QUALITY_CHECKER_VERSION &&
    (latest.summary as { evidenceHash?: string }).evidenceHash === evidenceHash
  )
    return { check: latest, cached: true };

  // 2. Compute (pure).
  const doc = parseCommunicationDocument(version.content);
  const claims = auditDocument(doc, evidence.corpus, read.declared);
  const findings = runQualityChecks({
    doc,
    context: {
      jobTitle: evidence.job?.title ?? null,
      companyName: evidence.job?.company ?? c.recipientCompany ?? null,
      candidateName: evidence.corpus.candidateName,
      recipientName: c.recipientName,
      length: c.length as "SHORT" | "STANDARD" | "DETAILED",
      resumeAssociated: Boolean(version.resumeVersionId),
      resumeText: evidence.resume?.text ?? null,
      userContext: c.userContext,
      avoidPhrases: read.avoidPhrases,
    },
    claims: claims.map((x) => ({
      location: x.location,
      text: x.text,
      claimKind: x.claimKind,
      status: x.status,
    })),
  });
  const summary = { ...summarizeQuality(findings), evidenceHash, claims: claims.length };

  // 3. Write (only if the content is still the content that was checked).
  return withUserContext(actor.userId, async (t) => {
    const current = await t.communicationVersion.findFirst({
      where: { id: version.id, userId: actor.userId },
      select: { contentHash: true },
    });
    if (!current || current.contentHash !== version.contentHash)
      throw new AppError("CONFLICT", {
        publicMessage: "The content changed while it was being checked. Run the check again.",
      });
    await persistClaims(t, actor, version.id, claims);
    const check = await t.communicationCheck.create({
      data: {
        userId: actor.userId,
        versionId: version.id,
        contentHash: version.contentHash,
        checkerVersion: QUALITY_CHECKER_VERSION,
        summary: summary as unknown as Prisma.InputJsonValue,
        findings: {
          createMany: {
            data: findings.map((f) => ({
              userId: actor.userId,
              category: f.category,
              code: f.code,
              severity: f.severity,
              message: f.message.slice(0, 1000),
              recommendation: f.recommendation?.slice(0, 1000) ?? null,
              location: f.location,
              evidence: f.evidence as Prisma.InputJsonValue,
            })),
          },
        },
      },
      include: { findings: true },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_checked",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: {
        checkId: check.id,
        passed: summary.passed,
        critical: summary.critical,
        warnings: summary.warnings,
        claims: claims.length,
      },
    });
    return { check, cached: false };
  });
}

// --- Review lifecycle ------------------------------------------------------------------------

const TRANSITIONS: Record<string, VersionStatus[]> = {
  DRAFT: ["READY_FOR_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "APPROVED", "REJECTED", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  APPROVED: ["ARCHIVED"],
  ARCHIVED: [],
};

export async function setCommunicationVersionStatus(
  actor: ActorRef,
  versionId: string,
  status: Exclude<VersionStatus, "APPROVED">,
) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    if (version.status === status) return version;
    if (!TRANSITIONS[version.status]?.includes(status))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `This version cannot move from ${version.status.toLowerCase()} to ${status.toLowerCase()}.`,
      });
    const updated = await t.communicationVersion.update({
      where: { id: version.id },
      data: { status },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_status_changed",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: { from: version.status, to: status },
    });
    return updated;
  });
}

/**
 * Approval gate: valid schema, no unsupported claims, a Resume-Check-style quality check for the
 * EXACT content hash with zero CRITICAL findings, and the caller confirming the hash they saw.
 * Idempotent (one active approval per version, partial unique index).
 */
export async function approveCommunicationVersion(
  actor: ActorRef,
  versionId: string,
  expectedHash: string,
) {
  const { check } = await runCommunicationCheck(actor, versionId);
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    assertActive(version.communication);
    const active = await t.communicationApproval.findFirst({
      where: { versionId: version.id, revokedAt: null },
    });
    if (active && active.contentHash === version.contentHash)
      return { approval: active, created: false };
    if (version.contentHash !== expectedHash)
      throw new AppError("CONFLICT", {
        publicMessage:
          "The content changed since you reviewed it. Review the latest content before approving.",
      });
    if (!TRANSITIONS[version.status]?.includes("APPROVED"))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `A ${version.status.toLowerCase()} version cannot be approved.`,
      });
    const doc = parseCommunicationDocument(version.content);
    if (communicationContentHash(doc) !== version.contentHash)
      throw new AppError("UNKNOWN_ERROR", {
        message: "content hash mismatch",
        publicMessage:
          "The stored content failed an integrity check. Save it again before approving.",
      });
    const unsupported = await t.communicationClaim.count({
      where: { versionId: version.id, status: "UNSUPPORTED" },
    });
    const summary = check.summary as { critical?: number; warnings?: number; info?: number };
    if (unsupported || (summary.critical ?? 0) > 0) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `Fix ${(summary.critical ?? 0) + (unsupported && !summary.critical ? unsupported : 0)} critical finding${(summary.critical ?? 0) === 1 ? "" : "s"} before approving (see the quality check).`,
      });
    }
    const approval = await t.communicationApproval.create({
      data: {
        userId: actor.userId,
        versionId: version.id,
        contentHash: version.contentHash,
        validationState: {
          checkId: check.id,
          ...summary,
          unsupportedClaims: unsupported,
        } as Prisma.InputJsonValue,
      },
    });
    await t.communicationVersion.update({
      where: { id: version.id },
      data: { status: "APPROVED" },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_approved",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: { contentHash: version.contentHash, approvalId: approval.id },
    });
    return { approval, created: true };
  });
}

export async function revokeCommunicationApproval(
  actor: ActorRef,
  versionId: string,
  reason: string,
) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    const active = await t.communicationApproval.findFirst({
      where: { versionId: version.id, revokedAt: null },
    });
    if (!active)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This version has no active approval.",
      });
    await t.communicationApproval.update({
      where: { id: active.id },
      data: {
        revokedAt: new Date(),
        revokeReason: reason.trim().slice(0, 500) || "Withdrawn by the candidate",
      },
    });
    await t.communicationVersion.update({
      where: { id: version.id },
      data: { status: "READY_FOR_REVIEW" },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_approval_revoked",
      resourceType: "communication_version",
      resourceId: version.id,
      metadata: { approvalId: active.id },
    });
  });
}

export async function archiveCommunication(actor: ActorRef, id: string, archived: boolean) {
  return withUserContext(actor.userId, async (t) => {
    const c = await ownedCommunication(t, actor, id);
    const updated = await t.communication.update({
      where: { id: c.id },
      data: archived
        ? { status: "ARCHIVED", archivedAt: new Date() }
        : { status: "ACTIVE", archivedAt: null },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: archived ? "communication_archived" : "communication_unarchived",
      resourceType: "communication",
      resourceId: c.id,
    });
    return updated;
  });
}

// --- Signature presets --------------------------------------------------------------------

export const signaturePresetInput = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  isDefault: z
    .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
    .default(false),
  fields: z.object(
    Object.fromEntries(
      SIGNATURE_FIELDS.map((k) => [k, optText(k === "email" ? 254 : 300)]),
    ) as Record<(typeof SIGNATURE_FIELDS)[number], ReturnType<typeof optText>>,
  ),
});

export async function listSignaturePresets(actor: ActorRef) {
  return withUserContext(actor.userId, (t) =>
    t.signaturePreset.findMany({
      where: { userId: actor.userId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
  );
}

export async function saveSignaturePreset(actor: ActorRef, raw: unknown, id?: string | null) {
  const input = signaturePresetInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    if (input.isDefault)
      await t.signaturePreset.updateMany({
        where: { userId: actor.userId, isDefault: true, ...(id ? { NOT: { id } } : {}) },
        data: { isDefault: false },
      });
    const data = {
      name: input.name,
      isDefault: input.isDefault,
      fields: input.fields as Prisma.InputJsonValue,
    };
    const preset = id
      ? await (async () => {
          const existing = await t.signaturePreset.findFirst({
            where: { id, userId: actor.userId },
          });
          if (!existing) throw new AppError("NOT_FOUND");
          return t.signaturePreset.update({ where: { id }, data });
        })()
      : await t.signaturePreset.create({ data: { ...data, userId: actor.userId } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "signature_preset_saved",
      resourceType: "signature_preset",
      resourceId: preset.id,
    });
    return preset;
  });
}

export async function deleteSignaturePreset(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.signaturePreset.deleteMany({ where: { id, userId: actor.userId } });
    if (!count) throw new AppError("NOT_FOUND");
    await recordAudit(t, {
      userId: actor.userId,
      action: "signature_preset_deleted",
      resourceType: "signature_preset",
      resourceId: id,
    });
  });
}

// --- Duplicate / compare / facts -------------------------------------------------------------

/** Copies the current content into a NEW communication (history of the original untouched). */
export async function duplicateCommunication(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await ownedCommunication(t, actor, id);
    const head = source.currentVersionId
      ? await t.communicationVersion.findUnique({ where: { id: source.currentVersionId } })
      : null;
    if (!head) throw new AppError("NOT_FOUND");
    const {
      id: _id,
      currentVersionId: _cv,
      createdAt: _c,
      updatedAt: _u,
      archivedAt: _a,
      ...settings
    } = source;
    const copy = await t.communication.create({
      data: {
        ...settings,
        strategy: (settings.strategy ?? {}) as Prisma.InputJsonValue,
        status: "ACTIVE",
        title: `${source.title} (copy)`.slice(0, 200),
      },
    });
    const version = await insertVersion(t, actor, {
      communicationId: copy.id,
      doc: parseCommunicationDocument(head.content),
      versionType: "DUPLICATED",
      contentSource:
        head.contentSource === "RESTORED" ? "USER_AUTHORED" : (head.contentSource as ContentSource),
      context: {
        requirementSetId: head.requirementSetId,
        jobResearchId: head.jobResearchId,
        match: head.matchId
          ? { id: head.matchId, overallStatus: "", computedAt: new Date(0) }
          : null,
        resumeVersion: head.resumeVersionId
          ? { id: head.resumeVersionId, resumeId: "", versionNumber: 0, status: "", resumeName: "" }
          : null,
        factsHash: "",
      },
      generation: { method: "DUPLICATE", from: head.id },
    });
    await copyClaims(t, actor, head.id, version.id);
    await recordAudit(t, {
      userId: actor.userId,
      action: "communication_duplicated",
      resourceType: "communication",
      resourceId: copy.id,
      metadata: { from: source.id, fromVersionId: head.id },
    });
    return copy;
  });
}

export async function compareCommunicationVersions(
  actor: ActorRef,
  fromVersionId: string,
  toVersionId: string,
) {
  return withUserContext(actor.userId, async (t) => {
    const [from, to] = [
      await ownedVersion(t, actor, fromVersionId),
      await ownedVersion(t, actor, toVersionId),
    ];
    if (from.communicationId !== to.communicationId)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Both versions must belong to the same communication.",
      });
    const entries = diffCommunications(
      parseCommunicationDocument(from.content),
      parseCommunicationDocument(to.content),
    );
    return {
      communication: from.communication,
      from,
      to,
      entries,
      summary: summarizeCommunicationDiff(entries),
    };
  });
}

/**
 * Explicit "Add as candidate fact": the user confirms a statement they wrote is true; it becomes
 * a USER_PROVIDED achievement (never VERIFIED) and the version is re-checked.
 */
export async function addClaimAsCandidateFact(actor: ActorRef, claimId: string) {
  const claim = await withUserContext(actor.userId, (t) =>
    t.communicationClaim.findFirst({ where: { id: claimId, userId: actor.userId } }),
  );
  if (!claim) throw new AppError("NOT_FOUND");
  if (claim.claimKind !== "CANDIDATE" || claim.status === "SUPPORTED")
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Only unsupported statements about you can be added as facts.",
    });
  const fact = await createFact(actor, "achievement", { statement: claim.text.slice(0, 1000) });
  await runCommunicationCheck(actor, claim.versionId, { force: true });
  return fact;
}

/** Evidence labels for a version's claims (fact labels, research claim text + source). */
export async function claimEvidence(actor: ActorRef, versionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    const evidence = await evidenceForVersion(t, actor, version, version.communication);
    const facts = new Map(evidence.corpus.facts.map((f) => [f.ref, f]));
    const research = new Map(evidence.corpus.research.map((r) => [r.id, r]));
    return { facts, research, loaded: evidence };
  });
}

// --- Pickers -------------------------------------------------------------------------------

/** Jobs the user works with (matched, tailored for, bookmarked, or already written for). */
export async function listJobOptions(actor: ActorRef, include?: string | null) {
  return withUserContext(actor.userId, async (t) => {
    const [matches, resumes, states, comms] = [
      await t.jobMatch.findMany({
        where: { userId: actor.userId, isCurrent: true },
        select: { jobId: true },
        orderBy: { computedAt: "desc" },
        take: 60,
      }),
      await t.resume.findMany({
        where: { userId: actor.userId, targetJobId: { not: null } },
        select: { targetJobId: true },
        take: 40,
      }),
      await t.userJobState.findMany({
        where: { userId: actor.userId, bookmarkedAt: { not: null } },
        select: { jobId: true },
        take: 60,
      }),
      await t.communication.findMany({
        where: { userId: actor.userId, jobId: { not: null } },
        select: { jobId: true },
        take: 40,
      }),
    ];
    const ids = [
      ...new Set(
        [
          include,
          ...resumes.map((r) => r.targetJobId),
          ...states.map((s) => s.jobId),
          ...comms.map((c) => c.jobId),
          ...matches.map((m) => m.jobId),
        ].filter((v): v is string => Boolean(v)),
      ),
    ].slice(0, 120);
    const jobs = await t.job.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      select: { id: true, title: true, company: { select: { name: true } } },
    });
    const order = new Map(ids.map((id, i) => [id, i]));
    return jobs
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((j) => ({ value: j.id, label: `${j.title} — ${j.company.name}` }));
  });
}

/** The user's resume versions: approved versions first, then each resume's working head. */
export async function listResumeVersionOptions(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const versions = await t.resumeVersion.findMany({
      where: {
        userId: actor.userId,
        resume: { status: "ACTIVE" },
        OR: [{ status: "APPROVED" }, { currentOf: { isNot: null } }],
      },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        targetJobId: true,
        resume: { select: { name: true, kind: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return versions
      .sort((a, b) => Number(b.status === "APPROVED") - Number(a.status === "APPROVED"))
      .map((v) => ({
        value: v.id,
        label: `${v.resume.name} · v${v.versionNumber} (${v.status === "APPROVED" ? "approved" : v.status.toLowerCase().replace(/_/g, " ")})`,
        targetJobId: v.targetJobId,
        approved: v.status === "APPROVED",
      }));
  });
}
