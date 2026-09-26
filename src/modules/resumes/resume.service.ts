import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getCandidateFacts } from "@/modules/candidate/knowledge.service";
import { getProfile } from "@/modules/candidate/profile.service";
import { isUsableStatus } from "@/modules/candidate/provenance";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { factText } from "./alignment";
import { buildResumeFromFacts, unrepresentedFacts, type BuilderFact } from "./builder";
import { validateClaim } from "./claims";
import { diffDocuments, summarizeDiff } from "./diff";
import {
  factReferences,
  parseResumeDocument,
  resumeDocumentSchema,
  type ResumeDocument,
} from "./document";
import { resumeContentHash } from "./hash";
import { PAGE_FORMATS, TEMPLATE_KEYS } from "./templates";

/**
 * Resume Studio service. Rules:
 *  - resumes are user-owned (service filters by userId; RLS enforces the same)
 *  - the working head (resumes.current_version_id) is edited in place ONLY while it is a DRAFT;
 *    editing any other state creates a new version (APPROVED content is immutable — DB trigger)
 *  - approvals bind the exact content hash; an edit never carries an approval forward
 *  - history is never deleted: versions/resumes are archived
 */

export type ActorRef = { userId: string; name?: string };

export const VERSION_TYPES = [
  "MASTER",
  "TAILORED",
  "MANUAL_EDIT",
  "RESTORED",
  "DUPLICATE",
] as const;
export const VERSION_STATUSES = [
  "DRAFT",
  "READY_FOR_REVIEW",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

export const STATUS_LABELS: Record<VersionStatus, string> = {
  DRAFT: "Draft",
  READY_FOR_REVIEW: "Ready for review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};

// --- Candidate inputs ---------------------------------------------------------------

/** The caller's usable facts (VERIFIED / USER_PROVIDED), excluding sensitive work authorization. */
export async function loadUsableFacts(actor: ActorRef, t: Tx): Promise<BuilderFact[]> {
  const facts = await getCandidateFacts(actor, { includeSensitive: false }, t);
  return facts
    .filter((f) => isUsableStatus(f.verificationStatus))
    .map((f) => ({ ref: f.ref, id: f.id, kind: f.kind, value: f.value }));
}

async function loadBuilderInputs(actor: ActorRef, t: Tx) {
  const [profile, facts] = [await getProfile(actor, t), await loadUsableFacts(actor, t)];
  const user = await t.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
  return { profile, facts, fallbackName: user?.name ?? "" };
}

// --- Persistence helpers -------------------------------------------------------------

async function writeFactRefs(t: Tx, userId: string, versionId: string, doc: ResumeDocument) {
  await t.resumeFactReference.deleteMany({ where: { versionId, userId } });
  const refs = factReferences(doc).map((r) => {
    const [kind, id] = r.factRef.split(":");
    return {
      userId,
      versionId,
      itemId: r.itemId,
      factRef: r.factRef,
      factKind: kind!,
      factId: id!,
    };
  });
  if (refs.length) await t.resumeFactReference.createMany({ data: refs, skipDuplicates: true });
}

async function nextVersionNumber(t: Tx, resumeId: string) {
  const last = await t.resumeVersion.findFirst({
    where: { resumeId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (last?.versionNumber ?? 0) + 1;
}

interface NewVersionInput {
  resumeId: string;
  doc: ResumeDocument;
  versionType: (typeof VERSION_TYPES)[number];
  title: string;
  parent?: { id: string; content: unknown } | null;
  targetJobId?: string | null;
  changeSet?: unknown;
  aiAssisted?: boolean;
  generation?: Record<string, unknown>;
}

export async function insertVersion(t: Tx, actor: ActorRef, input: NewVersionInput) {
  const doc = parseResumeDocument(input.doc);
  const parentDoc = input.parent ? parseResumeDocument(input.parent.content) : null;
  const changeSummary = parentDoc
    ? summarizeDiff(diffDocuments(parentDoc, doc))
    : { added: 0, removed: 0, changed: 0, reordered: 0, sections: {}, lines: [] };
  const version = await t.resumeVersion.create({
    data: {
      userId: actor.userId,
      resumeId: input.resumeId,
      versionNumber: await nextVersionNumber(t, input.resumeId),
      parentVersionId: input.parent?.id ?? null,
      versionType: input.versionType,
      status: "DRAFT",
      title: input.title.slice(0, 200),
      targetJobId: input.targetJobId ?? null,
      content: doc as unknown as Prisma.InputJsonValue,
      contentHash: resumeContentHash(doc),
      changeSummary: changeSummary as unknown as Prisma.InputJsonValue,
      changeSet: (input.changeSet ?? undefined) as Prisma.InputJsonValue | undefined,
      aiAssisted: input.aiAssisted ?? false,
      generation: (input.generation ?? {}) as Prisma.InputJsonValue,
    },
  });
  await writeFactRefs(t, actor.userId, version.id, doc);
  await t.resume.update({ where: { id: input.resumeId }, data: { currentVersionId: version.id } });
  return version;
}

async function ownedResume(t: Tx, actor: ActorRef, resumeId: string) {
  const resume = await t.resume.findFirst({ where: { id: resumeId, userId: actor.userId } });
  if (!resume) throw new AppError("NOT_FOUND");
  return resume;
}

async function ownedVersion(t: Tx, actor: ActorRef, versionId: string) {
  const version = await t.resumeVersion.findFirst({
    where: { id: versionId, userId: actor.userId },
    include: { resume: true },
  });
  if (!version) throw new AppError("NOT_FOUND");
  return version;
}

function assertActive(resume: { status: string }) {
  if (resume.status === "ARCHIVED")
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "This resume is archived. Restore it to make changes.",
    });
}

// --- Create --------------------------------------------------------------------------

/** Builds the master resume from usable candidate facts. Idempotent: returns the active master. */
export async function createMasterResume(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const existing = await t.resume.findFirst({
      where: { userId: actor.userId, kind: "MASTER", status: "ACTIVE" },
    });
    if (existing) return { resume: existing, created: false };
    const { profile, facts, fallbackName } = await loadBuilderInputs(actor, t);
    if (!profile)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage:
          "Create your candidate profile first — the resume is built from your verified facts.",
      });
    const doc = buildResumeFromFacts(profile, facts, fallbackName);
    const resume = await t.resume.create({
      data: { userId: actor.userId, name: "Master resume", kind: "MASTER" },
    });
    await insertVersion(t, actor, {
      resumeId: resume.id,
      doc,
      versionType: "MASTER",
      title: "Built from candidate facts",
      generation: { method: "BUILDER", facts: facts.length },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_created",
      resourceType: "resume",
      resourceId: resume.id,
      metadata: { kind: "MASTER", facts: facts.length },
    });
    return { resume: await ownedResume(t, actor, resume.id), created: true };
  });
}

/** A general (non-master) resume, built from facts or copied from an existing one. */
export async function createResume(
  actor: ActorRef,
  input: { name: string; fromResumeId?: string | null },
) {
  const name = input.name.trim().slice(0, 120);
  if (!name)
    throw new AppError("VALIDATION_ERROR", {
      details: [{ path: "name", message: "Enter a name" }],
    });
  if (input.fromResumeId) return duplicateResume(actor, input.fromResumeId, name);
  return withUserContext(actor.userId, async (t) => {
    const { profile, facts, fallbackName } = await loadBuilderInputs(actor, t);
    if (!profile)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage:
          "Create your candidate profile first — the resume is built from your verified facts.",
      });
    const resume = await t.resume.create({ data: { userId: actor.userId, name, kind: "GENERAL" } });
    await insertVersion(t, actor, {
      resumeId: resume.id,
      doc: buildResumeFromFacts(profile, facts, fallbackName),
      versionType: "MANUAL_EDIT",
      title: "Built from candidate facts",
      generation: { method: "BUILDER", facts: facts.length },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_created",
      resourceType: "resume",
      resourceId: resume.id,
      metadata: { kind: "GENERAL" },
    });
    return { resume, created: true };
  });
}

export async function duplicateResume(actor: ActorRef, resumeId: string, name?: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await ownedResume(t, actor, resumeId);
    const head = source.currentVersionId
      ? await t.resumeVersion.findUnique({ where: { id: source.currentVersionId } })
      : null;
    if (!head)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This resume has no content to duplicate.",
      });
    const resume = await t.resume.create({
      data: {
        userId: actor.userId,
        name: (name ?? `${source.name} (copy)`).slice(0, 120),
        kind: source.kind === "TAILORED" ? "TAILORED" : "GENERAL",
        template: source.template,
        pageFormat: source.pageFormat,
        sourceResumeId: source.id,
        targetJobId: source.targetJobId,
      },
    });
    await insertVersion(t, actor, {
      resumeId: resume.id,
      doc: parseResumeDocument(head.content),
      versionType: "DUPLICATE",
      title: `Copy of ${source.name} v${head.versionNumber}`,
      targetJobId: head.targetJobId,
      generation: { method: "DUPLICATE", from: head.id },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_duplicated",
      resourceType: "resume",
      resourceId: resume.id,
      metadata: { from: source.id, fromVersion: head.id },
    });
    return { resume, created: true };
  });
}

// --- Read ------------------------------------------------------------------------------

export async function listResumes(actor: ActorRef, opts: { includeArchived?: boolean } = {}) {
  return withUserContext(actor.userId, (t) =>
    t.resume.findMany({
      where: { userId: actor.userId, ...(opts.includeArchived ? {} : { status: "ACTIVE" }) },
      include: {
        currentVersion: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            contentHash: true,
            updatedAt: true,
            aiAssisted: true,
            versionType: true,
          },
        },
        targetJob: { select: { id: true, title: true, company: { select: { name: true } } } },
        _count: { select: { versions: true } },
      },
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    }),
  );
}

export async function listRecentVersions(actor: ActorRef, take = 12) {
  return withUserContext(actor.userId, (t) =>
    t.resumeVersion.findMany({
      where: { userId: actor.userId },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        versionType: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        resume: { select: { id: true, name: true, kind: true } },
        targetJob: { select: { id: true, title: true } },
      },
      orderBy: { updatedAt: "desc" },
      take,
    }),
  );
}

export async function getResumeWorkspace(
  actor: ActorRef,
  resumeId: string,
  versionId?: string | null,
) {
  return withUserContext(actor.userId, async (t) => {
    const resume = await t.resume.findFirst({
      where: { id: resumeId, userId: actor.userId },
      include: {
        targetJob: {
          select: { id: true, title: true, company: { select: { name: true } }, deletedAt: true },
        },
        sourceResume: { select: { id: true, name: true } },
        versions: {
          select: {
            id: true,
            versionNumber: true,
            status: true,
            versionType: true,
            title: true,
            contentHash: true,
            aiAssisted: true,
            createdAt: true,
            updatedAt: true,
            parentVersionId: true,
            targetJobId: true,
            changeSummary: true,
            approvals: {
              where: { revokedAt: null },
              select: { id: true, approvedAt: true, contentHash: true },
            },
          },
          orderBy: { versionNumber: "desc" },
        },
      },
    });
    if (!resume) throw new AppError("NOT_FOUND");
    const selectedId = versionId ?? resume.currentVersionId;
    const version = selectedId
      ? await t.resumeVersion.findFirst({
          where: { id: selectedId, resumeId: resume.id, userId: actor.userId },
        })
      : null;
    if (versionId && !version) throw new AppError("NOT_FOUND");
    const [latestCheck, exports, approvals] = version
      ? [
          await t.resumeCheck.findFirst({
            where: { versionId: version.id, userId: actor.userId },
            include: { findings: true },
            orderBy: { createdAt: "desc" },
          }),
          await t.resumeExport.findMany({
            where: { versionId: version.id, userId: actor.userId },
            orderBy: { createdAt: "desc" },
            take: 10,
          }),
          await t.resumeApproval.findMany({
            where: { versionId: version.id, userId: actor.userId },
            orderBy: { approvedAt: "desc" },
          }),
        ]
      : [null, [], []];
    const facts = await loadUsableFacts(actor, t);
    const doc = version ? parseResumeDocument(version.content) : null;
    return {
      resume,
      version,
      doc,
      latestCheck,
      exports,
      approvals,
      isHead: version?.id === resume.currentVersionId,
      unrepresented: doc ? unrepresentedFacts(doc, facts).length : 0,
      facts: facts.map((f) => ({ ref: f.ref, kind: f.kind, label: factLabelOf(f) })),
    };
  });
}

function factLabelOf(f: BuilderFact): string {
  const v = f.value;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  switch (f.kind) {
    case "experience":
      return `${s("title")} — ${s("organization")}`;
    case "project":
      return s("name");
    case "education":
      return [s("degree"), s("institution")].filter(Boolean).join(", ");
    case "skill":
      return s("name");
    case "achievement":
      return s("statement").slice(0, 90);
    case "certification":
      return s("name");
    case "language":
      return s("language");
    case "portfolio":
      return s("title");
    default:
      return f.ref;
  }
}

export async function getVersionForRender(actor: ActorRef, versionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    return { version, resume: version.resume, doc: parseResumeDocument(version.content) };
  });
}

// --- Edit --------------------------------------------------------------------------------

/**
 * Re-derives provenance for items whose text changed: origin MANUAL, editedAt set and the claim
 * status re-validated against the facts the item cites (UNKNOWN when it cites none). A manual
 * edit is never silently presented as verified.
 */
export function reconcileEdits(
  before: ResumeDocument | null,
  after: ResumeDocument,
  facts: BuilderFact[],
  now = new Date(),
): ResumeDocument {
  const byRef = new Map(facts.map((f) => [f.ref, f]));
  const prev = new Map<string, string>();
  if (before) {
    const collect = (id: string, text: string) => prev.set(id, text);
    if (before.summary) collect(before.summary.id, before.summary.text);
    for (const h of [...before.experience, ...before.projects])
      for (const b of h.bullets) collect(b.id, b.text);
    for (const a of before.additional) for (const b of a.bullets) collect(b.id, b.text);
  }
  const touch = <
    T extends {
      id: string;
      text: string;
      factRefs: string[];
      origin: string;
      claimStatus: string;
      editedAt: string | null;
    },
  >(
    item: T,
  ): T => {
    const old = prev.get(item.id);
    if (old !== undefined && old === item.text) return item;
    const cited = item.factRefs
      .map((r) => byRef.get(r))
      .filter((f): f is BuilderFact => Boolean(f));
    const check = cited.length
      ? validateClaim(item.text, { texts: cited.map((f) => factText(f)) })
      : null;
    return {
      ...item,
      origin: "MANUAL",
      editedAt: now.toISOString(),
      claimStatus: check ? check.status : "UNKNOWN",
      factRefs: cited.map((f) => f.ref),
    };
  };
  const next: ResumeDocument = JSON.parse(JSON.stringify(after));
  if (next.summary) next.summary = touch(next.summary);
  for (const h of [...next.experience, ...next.projects]) h.bullets = h.bullets.map(touch);
  for (const a of next.additional) a.bullets = a.bullets.map(touch);
  return parseResumeDocument(next);
}

/**
 * Saves editor content. `expectedHash` is the hash the editor started from (optimistic
 * concurrency: a stale tab cannot overwrite newer content). DRAFT heads are updated in place;
 * any other state gets a new MANUAL_EDIT version.
 */
export async function saveResumeContent(
  actor: ActorRef,
  resumeId: string,
  input: { content: unknown; expectedHash: string },
) {
  const parsed = resumeDocumentSchema.safeParse(input.content);
  if (!parsed.success) {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Some fields are invalid.",
      details: parsed.error.issues
        .slice(0, 10)
        .map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return withUserContext(actor.userId, async (t) => {
    const resume = await ownedResume(t, actor, resumeId);
    assertActive(resume);
    const head = resume.currentVersionId
      ? await t.resumeVersion.findUnique({ where: { id: resume.currentVersionId } })
      : null;
    if (!head) throw new AppError("NOT_FOUND");
    if (head.contentHash !== input.expectedHash) {
      throw new AppError("CONFLICT", {
        publicMessage:
          "This resume was changed elsewhere (another tab or action). Reload to see the latest version — your edits were not saved.",
      });
    }
    const facts = await loadUsableFacts(actor, t);
    const before = parseResumeDocument(head.content);
    const doc = reconcileEdits(before, parsed.data, facts);
    const hash = resumeContentHash(doc);
    if (hash === head.contentHash) return { version: head, created: false, unchanged: true };

    if (head.status === "DRAFT") {
      const parent = head.parentVersionId
        ? await t.resumeVersion.findUnique({
            where: { id: head.parentVersionId },
            select: { content: true },
          })
        : null;
      const summary = parent
        ? summarizeDiff(diffDocuments(parseResumeDocument(parent.content), doc))
        : head.changeSummary;
      const version = await t.resumeVersion.update({
        where: { id: head.id },
        data: {
          content: doc as unknown as Prisma.InputJsonValue,
          contentHash: hash,
          changeSummary: summary as unknown as Prisma.InputJsonValue,
        },
      });
      await writeFactRefs(t, actor.userId, version.id, doc);
      await t.resume.update({ where: { id: resume.id }, data: { updatedAt: new Date() } });
      await recordAudit(t, {
        userId: actor.userId,
        action: "resume_edited",
        resourceType: "resume_version",
        resourceId: version.id,
        metadata: { resumeId: resume.id },
      });
      return { version, created: false, unchanged: false };
    }
    const version = await insertVersion(t, actor, {
      resumeId: resume.id,
      doc,
      versionType: "MANUAL_EDIT",
      title: `Edited from v${head.versionNumber}${head.status === "APPROVED" ? " (approved version unchanged)" : ""}`,
      parent: { id: head.id, content: head.content },
      targetJobId: head.targetJobId,
      aiAssisted: head.aiAssisted,
      generation: { method: "MANUAL_EDIT", from: head.id, supersedes: head.status },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_version_created",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { resumeId: resume.id, from: head.id, fromStatus: head.status },
    });
    return { version, created: true, unchanged: false };
  });
}

/** Freezes the current head as history and continues in a new DRAFT version. */
export async function saveAsNewVersion(actor: ActorRef, resumeId: string, title?: string) {
  return withUserContext(actor.userId, async (t) => {
    const resume = await ownedResume(t, actor, resumeId);
    assertActive(resume);
    const head = resume.currentVersionId
      ? await t.resumeVersion.findUnique({ where: { id: resume.currentVersionId } })
      : null;
    if (!head) throw new AppError("NOT_FOUND");
    const version = await insertVersion(t, actor, {
      resumeId: resume.id,
      doc: parseResumeDocument(head.content),
      versionType: "MANUAL_EDIT",
      title: title?.trim() || `Continued from v${head.versionNumber}`,
      parent: { id: head.id, content: head.content },
      targetJobId: head.targetJobId,
      aiAssisted: head.aiAssisted,
      generation: { method: "SNAPSHOT", from: head.id },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_version_created",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { resumeId: resume.id, from: head.id },
    });
    return version;
  });
}

export async function restoreVersion(actor: ActorRef, versionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const source = await ownedVersion(t, actor, versionId);
    assertActive(source.resume);
    const head = source.resume.currentVersionId
      ? await t.resumeVersion.findUnique({ where: { id: source.resume.currentVersionId } })
      : null;
    const version = await insertVersion(t, actor, {
      resumeId: source.resumeId,
      doc: parseResumeDocument(source.content),
      versionType: "RESTORED",
      title: `Restored from v${source.versionNumber}`,
      parent: head ? { id: head.id, content: head.content } : null,
      targetJobId: source.targetJobId,
      aiAssisted: source.aiAssisted,
      generation: { method: "RESTORE", from: source.id },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_restored",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { from: source.id },
    });
    return version;
  });
}

/** Adds candidate facts that are not yet in the resume (e.g. after adding facts) as a new draft state. */
export async function addNewFactsToResume(actor: ActorRef, resumeId: string) {
  return withUserContext(actor.userId, async (t) => {
    const resume = await ownedResume(t, actor, resumeId);
    assertActive(resume);
    const head = resume.currentVersionId
      ? await t.resumeVersion.findUnique({ where: { id: resume.currentVersionId } })
      : null;
    if (!head) throw new AppError("NOT_FOUND");
    const { profile, facts, fallbackName } = await loadBuilderInputs(actor, t);
    const doc = parseResumeDocument(head.content);
    const missing = new Set(unrepresentedFacts(doc, facts).map((f) => f.ref));
    if (!missing.size) return { added: 0, version: head };
    const built = buildResumeFromFacts(profile, facts, fallbackName);
    const pick = <T extends { factRefs: string[] }>(items: T[]) =>
      items.filter((i) => i.factRefs.some((r) => missing.has(r)));
    doc.experience.push(...pick(built.experience));
    doc.projects.push(...pick(built.projects));
    doc.education.push(...pick(built.education));
    doc.certifications.push(...pick(built.certifications));
    doc.languages.push(...pick(built.languages));
    doc.links.push(...pick(built.links).filter((l) => !doc.links.some((x) => x.url === l.url)));
    for (const g of built.skills) {
      const skills = pick(g.skills);
      if (!skills.length) continue;
      const target = doc.skills.find((x) => x.label === g.label);
      if (target)
        target.skills.push(
          ...skills.filter(
            (s) => !target.skills.some((x) => x.name.toLowerCase() === s.name.toLowerCase()),
          ),
        );
      else doc.skills.push({ ...g, skills });
    }
    for (const a of built.additional) {
      const bullets = a.bullets.filter((b) => b.factRefs.some((r) => missing.has(r)));
      if (!bullets.length) continue;
      const target = doc.additional.find((x) => x.title === a.title);
      if (target) target.bullets.push(...bullets);
      else doc.additional.push({ ...a, bullets });
    }
    const next = parseResumeDocument(doc);
    const result = await (async () => {
      if (head.status === "DRAFT") {
        const v = await t.resumeVersion.update({
          where: { id: head.id },
          data: {
            content: next as unknown as Prisma.InputJsonValue,
            contentHash: resumeContentHash(next),
          },
        });
        await writeFactRefs(t, actor.userId, v.id, next);
        return v;
      }
      return insertVersion(t, actor, {
        resumeId: resume.id,
        doc: next,
        versionType: "MANUAL_EDIT",
        title: `Added new candidate facts to v${head.versionNumber}`,
        parent: { id: head.id, content: head.content },
        targetJobId: head.targetJobId,
        generation: { method: "ADD_FACTS" },
      });
    })();
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_edited",
      resourceType: "resume_version",
      resourceId: result.id,
      metadata: { addedFacts: missing.size },
    });
    return { added: missing.size, version: result };
  });
}

export async function updateResumeSettings(
  actor: ActorRef,
  resumeId: string,
  input: { name?: string; template?: string; pageFormat?: string; description?: string | null },
) {
  const data: Prisma.ResumeUpdateInput = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 120)
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "name", message: "Enter a name (max 120 characters)" }],
      });
    data.name = name;
  }
  if (input.template !== undefined) {
    if (!(TEMPLATE_KEYS as readonly string[]).includes(input.template))
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "template", message: "Unknown template" }],
      });
    data.template = input.template;
  }
  if (input.pageFormat !== undefined) {
    if (!(PAGE_FORMATS as readonly string[]).includes(input.pageFormat))
      throw new AppError("VALIDATION_ERROR", {
        details: [{ path: "pageFormat", message: "Unknown page format" }],
      });
    data.pageFormat = input.pageFormat;
  }
  if (input.description !== undefined)
    data.description = input.description?.trim().slice(0, 1000) || null;
  return withUserContext(actor.userId, async (t) => {
    const resume = await ownedResume(t, actor, resumeId);
    const updated = await t.resume.update({ where: { id: resume.id }, data });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_settings_updated",
      resourceType: "resume",
      resourceId: resume.id,
      metadata: { fields: Object.keys(data) },
    });
    return updated;
  });
}

// --- Review lifecycle ------------------------------------------------------------------------

/** Visible items that must not reach an approved/exported resume. */
export function blockingClaims(doc: ResumeDocument): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const vis = new Set(doc.sections.filter((s) => s.visible).map((s) => s.key));
  if (
    vis.has("summary") &&
    doc.summary &&
    !doc.summary.hidden &&
    doc.summary.claimStatus === "UNSUPPORTED"
  )
    out.push({ id: doc.summary.id, text: doc.summary.text });
  for (const [key, holders] of [
    ["experience", doc.experience],
    ["projects", doc.projects],
  ] as const) {
    if (!vis.has(key)) continue;
    for (const h of holders.filter((x) => !x.hidden))
      for (const b of h.bullets.filter((x) => !x.hidden && x.claimStatus === "UNSUPPORTED"))
        out.push({ id: b.id, text: b.text });
  }
  if (vis.has("additional"))
    for (const a of doc.additional.filter((x) => !x.hidden))
      for (const b of a.bullets.filter((x) => !x.hidden && x.claimStatus === "UNSUPPORTED"))
        out.push({ id: b.id, text: b.text });
  return out;
}

const TRANSITIONS: Record<string, VersionStatus[]> = {
  DRAFT: ["READY_FOR_REVIEW", "APPROVED", "REJECTED", "ARCHIVED"],
  READY_FOR_REVIEW: ["DRAFT", "APPROVED", "REJECTED", "ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  APPROVED: ["ARCHIVED"],
  ARCHIVED: [],
};

export async function setVersionStatus(
  actor: ActorRef,
  versionId: string,
  status: Exclude<VersionStatus, "APPROVED">,
) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    if (version.status === status) return version;
    if (!TRANSITIONS[version.status]?.includes(status)) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `A ${STATUS_LABELS[version.status as VersionStatus].toLowerCase()} version cannot become ${STATUS_LABELS[status].toLowerCase()}.`,
      });
    }
    if (status === "READY_FOR_REVIEW") {
      const blocking = blockingClaims(parseResumeDocument(version.content));
      if (blocking.length)
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: `${blocking.length} unsupported statement${blocking.length === 1 ? "" : "s"} must be removed or fixed first.`,
        });
    }
    const updated = await t.resumeVersion.update({ where: { id: version.id }, data: { status } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_status_changed",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { from: version.status, to: status },
    });
    return updated;
  });
}

/**
 * Approves the exact content of a version. Idempotent (one active approval per version,
 * enforced by a partial unique index). Unsupported visible claims block approval.
 */
export async function approveVersion(actor: ActorRef, versionId: string, expectedHash: string) {
  // Readiness gate for tailored versions: nothing that fails the job's requirements, the Resume
  // Check or claim validation can be approved (and therefore used by any later phase).
  const { getReadiness } = await import("./readiness.service");
  const readiness = await getReadiness(actor, versionId);
  if (!readiness.ready) {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `Not ready for approval — ${readiness.blockers.length} check${readiness.blockers.length === 1 ? "" : "s"} did not pass: ${readiness.blockers.slice(0, 3).join(" · ")}${readiness.blockers.length > 3 ? " …" : ""}`,
    });
  }
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    assertActive(version.resume);
    const active = await t.resumeApproval.findFirst({
      where: { versionId: version.id, revokedAt: null },
    });
    if (active && active.contentHash === version.contentHash)
      return { approval: active, created: false };
    if (version.contentHash !== expectedHash) {
      throw new AppError("CONFLICT", {
        publicMessage:
          "The content changed since you reviewed it. Review the latest content before approving.",
      });
    }
    if (!TRANSITIONS[version.status]?.includes("APPROVED")) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `A ${STATUS_LABELS[version.status as VersionStatus].toLowerCase()} version cannot be approved.`,
      });
    }
    const doc = parseResumeDocument(version.content);
    const blocking = blockingClaims(doc);
    if (blocking.length)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `${blocking.length} unsupported statement${blocking.length === 1 ? "" : "s"} must be removed or fixed before approval.`,
      });
    if (resumeContentHash(doc) !== version.contentHash) {
      throw new AppError("UNKNOWN_ERROR", {
        message: "Stored content hash does not match content",
        publicMessage:
          "The stored resume content failed an integrity check. Save it again before approving.",
      });
    }
    const approval = await t.resumeApproval.create({
      data: { userId: actor.userId, versionId: version.id, contentHash: version.contentHash },
    });
    await t.resumeVersion.update({ where: { id: version.id }, data: { status: "APPROVED" } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_approved",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { contentHash: version.contentHash, approvalId: approval.id },
    });
    return { approval, created: true };
  });
}

/** Withdraws an approval (history kept). The version returns to review. */
export async function revokeApproval(actor: ActorRef, versionId: string, reason: string) {
  return withUserContext(actor.userId, async (t) => {
    const version = await ownedVersion(t, actor, versionId);
    const active = await t.resumeApproval.findFirst({
      where: { versionId: version.id, revokedAt: null },
    });
    if (!active)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This version has no active approval.",
      });
    await t.resumeApproval.update({
      where: { id: active.id },
      data: {
        revokedAt: new Date(),
        revokeReason: reason.trim().slice(0, 500) || "Withdrawn by the candidate",
      },
    });
    await t.resumeVersion.update({
      where: { id: version.id },
      data: { status: "READY_FOR_REVIEW" },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_approval_revoked",
      resourceType: "resume_version",
      resourceId: version.id,
      metadata: { approvalId: active.id },
    });
  });
}

export async function archiveResume(actor: ActorRef, resumeId: string, archived: boolean) {
  return withUserContext(actor.userId, async (t) => {
    const resume = await ownedResume(t, actor, resumeId);
    if (!archived && resume.kind === "MASTER") {
      const other = await t.resume.findFirst({
        where: { userId: actor.userId, kind: "MASTER", status: "ACTIVE", NOT: { id: resume.id } },
      });
      if (other)
        throw new AppError("CONFLICT", {
          publicMessage: "You already have an active master resume. Archive it first.",
        });
    }
    const updated = await t.resume.update({
      where: { id: resume.id },
      data: archived
        ? { status: "ARCHIVED", archivedAt: new Date() }
        : { status: "ACTIVE", archivedAt: null },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: archived ? "resume_archived" : "resume_unarchived",
      resourceType: "resume",
      resourceId: resume.id,
    });
    return updated;
  });
}

export async function compareVersions(actor: ActorRef, fromVersionId: string, toVersionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const [from, to] = [
      await ownedVersion(t, actor, fromVersionId),
      await ownedVersion(t, actor, toVersionId),
    ];
    const a = parseResumeDocument(from.content);
    const b = parseResumeDocument(to.content);
    const entries = diffDocuments(a, b);
    return { from, to, fromDoc: a, toDoc: b, entries, summary: summarizeDiff(entries) };
  });
}
