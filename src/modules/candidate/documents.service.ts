import "server-only";
import { getServerEnv } from "@/config/env";
import { uuidv7 } from "@/lib/ids";
import { getAiRoute } from "@/server/ai/orchestrator";
import { AI_UNAVAILABLE_MESSAGE } from "@/server/ai/providers/ollama";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { mapInSequence, withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { documentStorageKey, getStorage } from "@/server/storage";
import { findBestDuplicate, type Comparable, type DuplicateMatch } from "./duplicates";
import { extractFactsWithAi } from "./extraction/ai-extract";
import {
  extractText,
  MIME_TYPES,
  sniffFileType,
  type SupportedFileType,
} from "./extraction/extract-text";
import { parseCvText, type FactDraft } from "./extraction/parse-rules";
import type { ActorRef } from "./facts.service";
import { toComparable } from "./labels";
import { ensureProfile, getProfile } from "./profile.service";
import {
  documentTypeInput,
  profileUpdateInput,
  SECTION_SCHEMAS,
  type SectionKind,
} from "./schemas";
import { SECTIONS } from "./sections";

const log = logger.child({ category: "app", module: "candidate.documents" });

export const UNSUPPORTED_FILE_MESSAGE = "Unsupported file type. Upload a PDF, DOCX or TXT file.";
const STALE_PROCESSING_MS = 10 * 60 * 1000;

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (clean || "document").slice(0, 200);
}

export interface UploadInput {
  fileName: string;
  bytes: Uint8Array;
  documentType: string;
}

export async function uploadDocument(actor: ActorRef, input: UploadInput) {
  const maxBytes = getServerEnv().MAX_UPLOAD_BYTES;
  if (input.bytes.byteLength === 0) {
    throw new AppError("VALIDATION_ERROR", { publicMessage: "The file is empty." });
  }
  if (input.bytes.byteLength > maxBytes) {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `Document too large. The maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    });
  }
  const fileName = sanitizeFileName(input.fileName);
  const fileType = sniffFileType(input.bytes, fileName);
  if (!fileType)
    throw new AppError("VALIDATION_ERROR", { publicMessage: UNSUPPORTED_FILE_MESSAGE });
  const documentType = documentTypeInput.parse(input.documentType);
  const sha256 = sha256Hex(input.bytes);

  const { profileId } = await withUserContext(actor.userId, async (tx) => {
    const profile = await ensureProfile(actor, tx);
    const duplicate = await tx.candidateDocument.findFirst({
      where: { userId: actor.userId, sha256 },
      select: { id: true },
    });
    if (duplicate) {
      throw new AppError("CONFLICT", {
        publicMessage: "You have already uploaded this exact file.",
      });
    }
    return { profileId: profile.id };
  });

  const id = uuidv7();
  const storagePath = documentStorageKey(actor.userId, profileId, id);
  await getStorage().put(storagePath, input.bytes, MIME_TYPES[fileType]);

  try {
    return await withUserContext(actor.userId, async (tx) => {
      const document = await tx.candidateDocument.create({
        data: {
          id,
          userId: actor.userId,
          candidateId: profileId,
          fileName,
          fileType,
          sizeBytes: input.bytes.byteLength,
          sha256,
          storagePath,
          documentType,
          status: "UPLOADED",
        },
      });
      await recordAudit(tx, {
        userId: actor.userId,
        action: "document_uploaded",
        resourceType: "candidate_document",
        resourceId: id,
        metadata: { fileType, documentType, sizeBytes: input.bytes.byteLength },
      });
      return document;
    });
  } catch (error) {
    await getStorage()
      .remove([storagePath])
      .catch(() => undefined);
    throw error;
  }
}

// --- Processing ---------------------------------------------------------------------

export interface ProcessResult {
  status: "PROCESSED" | "FAILED";
  candidates: number;
  aiStatus: string;
  aiMessage?: string;
  errorMessage?: string;
}

async function markFailed(
  actor: ActorRef,
  documentId: string,
  code: string,
  publicMessage: string,
) {
  await withUserContext(actor.userId, async (tx) => {
    await tx.candidateDocument.update({
      where: { id: documentId },
      data: {
        status: "FAILED",
        errorCode: code,
        errorMessage: publicMessage,
        processedAt: new Date(),
      },
    });
    await recordAudit(tx, {
      userId: actor.userId,
      action: "document_processing_failed",
      resourceType: "candidate_document",
      resourceId: documentId,
      metadata: { errorCode: code },
    });
  });
}

function draftKey(draft: FactDraft): string {
  if (draft.category === "profile") return `profile:${String(draft.payload.field)}`;
  const comparable = toComparable(draft.category, "x", draft.payload);
  const identity = comparable
    ? `${comparable.primary}|${comparable.secondary ?? ""}`
    : JSON.stringify(draft.payload);
  return `${draft.category}:${identity.toLowerCase().replace(/[^a-z0-9#+|]/g, "")}`;
}

/** Deterministic merge: one draft per identity, higher confidence wins, RULE wins ties. */
export function mergeDrafts(rule: FactDraft[], ai: FactDraft[]): FactDraft[] {
  const byKey = new Map<string, FactDraft>();
  for (const draft of [...rule, ...ai]) {
    const key = draftKey(draft);
    const current = byKey.get(key);
    if (!current || draft.confidence > current.confidence) byKey.set(key, draft);
  }
  return Array.from(byKey.values());
}

/** Validate drafts against the same schemas used for manual entry; drop anything invalid. */
export function validateDrafts(drafts: FactDraft[]): FactDraft[] {
  return drafts.flatMap((draft) => {
    if (draft.category === "profile") {
      const field = String(draft.payload.field);
      const parsed = profileUpdateInput.safeParse({ [field]: draft.payload.value });
      const value = parsed.success ? (parsed.data as Record<string, unknown>)[field] : null;
      return value ? [{ ...draft, payload: { field, value } }] : [];
    }
    const parsed = SECTION_SCHEMAS[draft.category].safeParse(draft.payload);
    return parsed.success ? [{ ...draft, payload: parsed.data as Record<string, unknown> }] : [];
  });
}

const DUPLICATE_SECTION_KINDS: SectionKind[] = [
  "education",
  "experience",
  "skill",
  "project",
  "portfolio",
  "certification",
  "language",
];

export async function existingComparables(actor: ActorRef, tx: Tx): Promise<Comparable[]> {
  const lists = await mapInSequence(DUPLICATE_SECTION_KINDS, async (kind) => {
    const rows = await SECTIONS[kind]
      .delegate(tx)
      .findMany({ where: { userId: actor.userId, deletedAt: null } });
    return rows
      .map((row) => toComparable(kind, row.id, row))
      .filter((c): c is Comparable => c !== null);
  });
  return lists.flat();
}

export async function processDocument(
  actor: ActorRef,
  documentId: string,
  options: { useAi?: boolean; traceId?: string } = {},
): Promise<ProcessResult> {
  const doc = await withUserContext(actor.userId, async (tx) => {
    const found = await tx.candidateDocument.findFirst({
      where: { id: documentId, userId: actor.userId },
    });
    if (!found) throw new AppError("NOT_FOUND");
    const startedAt = found.processingStartedAt?.getTime() ?? 0;
    if (found.status === "PROCESSING" && Date.now() - startedAt < STALE_PROCESSING_MS) {
      throw new AppError("CONFLICT", {
        publicMessage: "This document is already being processed.",
      });
    }
    return tx.candidateDocument.update({
      where: { id: found.id },
      data: {
        status: "PROCESSING",
        processingStartedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
  });

  let text: string;
  try {
    const bytes = await getStorage().get(doc.storagePath);
    text = await extractText(bytes, doc.fileType as SupportedFileType);
  } catch (error) {
    const appError = error instanceof AppError ? error : null;
    const code =
      appError?.message === "EMPTY_TEXT"
        ? "EMPTY_TEXT"
        : appError?.code === "EXTERNAL_SERVICE_ERROR"
          ? "STORAGE_ERROR"
          : "EXTRACTION_FAILED";
    const publicMessage =
      appError?.publicMessage ?? "CV extraction failed. You can enter the information manually.";
    log.warn("document extraction failed", { documentId, userId: actor.userId, code });
    await markFailed(actor, doc.id, code, publicMessage);
    return { status: "FAILED", candidates: 0, aiStatus: "SKIPPED", errorMessage: publicMessage };
  }

  const ruleDrafts = validateDrafts(parseCvText(text));
  const wantsAi = options.useAi !== false;
  const ai =
    wantsAi && (await getAiRoute(actor.userId, "candidate.extract_facts")).steps.length > 0
      ? await extractFactsWithAi({
          userId: actor.userId,
          documentText: text,
          traceId: options.traceId,
        })
      : { status: "DISABLED" as const, drafts: [], discarded: 0, generationId: null };
  const drafts = mergeDrafts(ruleDrafts, validateDrafts(ai.drafts));
  const aiMessage =
    ai.status === "UNAVAILABLE" || ai.status === "DISABLED"
      ? AI_UNAVAILABLE_MESSAGE
      : ai.status === "SCHEMA_INVALID"
        ? "The local AI returned an invalid result, so only rule-based extraction was used."
        : undefined;

  const count = await withUserContext(actor.userId, async (tx) => {
    const comparables = await existingComparables(actor, tx);
    const profile = await getProfile(actor, tx);
    await tx.candidateFactCandidate.deleteMany({
      where: { documentId: doc.id, userId: actor.userId, status: "PENDING" },
    });

    let created = 0;
    for (const draft of drafts) {
      let duplicateOf: DuplicateMatch | { kind: "profile"; label: string } | null = null;
      if (draft.category === "profile") {
        const field = String(draft.payload.field);
        const current = (profile as Record<string, unknown> | null)?.[field];
        if (current === draft.payload.value) continue; // already identical — nothing to review
        if (current) duplicateOf = { kind: "profile", label: "Replaces your current value" };
      } else {
        const comparable = toComparable(draft.category, "candidate", draft.payload);
        duplicateOf = comparable ? findBestDuplicate(comparable, comparables) : null;
      }
      await tx.candidateFactCandidate.create({
        data: {
          userId: actor.userId,
          documentId: doc.id,
          category: draft.category,
          payload: draft.payload as object,
          excerpt: draft.excerpt,
          confidence: Math.max(0, Math.min(1, draft.confidence)),
          method: draft.method,
          proposedStatus: "NEEDS_REVIEW",
          duplicateOf: duplicateOf ? (duplicateOf as object) : undefined,
          aiGenerationId: draft.method === "AI" ? ai.generationId : null,
        },
      });
      created++;
    }

    await tx.candidateDocument.update({
      where: { id: doc.id },
      data: {
        status: "PROCESSED",
        extractedText: text,
        processedAt: new Date(),
        aiStatus: ai.status,
      },
    });
    await recordAudit(tx, {
      userId: actor.userId,
      action: "document_processed",
      resourceType: "candidate_document",
      resourceId: doc.id,
      metadata: {
        candidates: created,
        ruleDrafts: ruleDrafts.length,
        aiDrafts: ai.drafts.length,
        aiDiscarded: ai.discarded,
        aiStatus: ai.status,
      },
    });
    if (created > 0) {
      await recordAudit(tx, {
        userId: actor.userId,
        action: "fact_created",
        resourceType: "fact_candidate",
        resourceId: doc.id,
        metadata: { count: created, status: "NEEDS_REVIEW" },
      });
    }
    return created;
  });

  log.info("document processed", {
    documentId: doc.id,
    userId: actor.userId,
    candidates: count,
    aiStatus: ai.status,
  });
  return { status: "PROCESSED", candidates: count, aiStatus: ai.status, aiMessage };
}

// --- Queries & management -----------------------------------------------------------------

export async function listDocuments(actor: ActorRef) {
  return withUserContext(actor.userId, async (tx) => {
    const documents = await tx.candidateDocument.findMany({
      where: { userId: actor.userId },
      orderBy: { uploadedAt: "desc" },
      omit: { extractedText: true },
      include: { factCandidates: { select: { status: true, resultKind: true } } },
    });
    return documents.map(({ factCandidates, ...doc }) => ({
      ...doc,
      counts: {
        pending: factCandidates.filter((c) => c.status === "PENDING").length,
        approved: factCandidates.filter((c) => c.status === "APPROVED").length,
        rejected: factCandidates.filter((c) => c.status === "REJECTED").length,
      },
      relatedSections: Array.from(
        new Set(
          factCandidates
            .filter((c) => c.status === "APPROVED" && c.resultKind)
            .map((c) => c.resultKind!),
        ),
      ),
    }));
  });
}

export async function getDocument(actor: ActorRef, documentId: string) {
  return withUserContext(actor.userId, async (tx) => {
    const document = await tx.candidateDocument.findFirst({
      where: { id: documentId, userId: actor.userId },
      include: { factCandidates: { orderBy: [{ status: "asc" }, { category: "asc" }] } },
    });
    if (!document) throw new AppError("NOT_FOUND");
    const derived = await mapInSequence(Object.keys(SECTIONS) as SectionKind[], async (kind) => ({
      kind,
      records: await SECTIONS[kind].delegate(tx).findMany({
        where: { userId: actor.userId, sourceDocumentId: document.id, deletedAt: null },
      }),
    }));
    return { document, derivedFacts: derived.filter((d) => d.records.length > 0) };
  });
}

export async function getDocumentStatus(actor: ActorRef, documentId: string) {
  return withUserContext(actor.userId, async (tx) => {
    const document = await tx.candidateDocument.findFirst({
      where: { id: documentId, userId: actor.userId },
      select: { id: true, status: true, aiStatus: true, errorMessage: true, processedAt: true },
    });
    if (!document) throw new AppError("NOT_FOUND");
    const pending = await tx.candidateFactCandidate.count({
      where: { documentId, userId: actor.userId, status: "PENDING" },
    });
    return { ...document, pending };
  });
}

export async function deleteDocument(actor: ActorRef, documentId: string) {
  const document = await withUserContext(actor.userId, (tx) =>
    tx.candidateDocument.findFirst({
      where: { id: documentId, userId: actor.userId },
      select: { id: true, storagePath: true },
    }),
  );
  if (!document) throw new AppError("NOT_FOUND");
  // File first: if storage fails the record stays and the user can retry.
  await getStorage().remove([document.storagePath]);
  await withUserContext(actor.userId, async (tx) => {
    // Facts derived from this document keep their excerpt and source type; the link is cleared.
    await tx.candidateDocument.delete({ where: { id: document.id } });
    await recordAudit(tx, {
      userId: actor.userId,
      action: "document_deleted",
      resourceType: "candidate_document",
      resourceId: document.id,
    });
  });
}

export async function getDocumentDownload(actor: ActorRef, documentId: string) {
  const document = await withUserContext(actor.userId, async (tx) => {
    const found = await tx.candidateDocument.findFirst({
      where: { id: documentId, userId: actor.userId },
      select: { id: true, storagePath: true, fileName: true, fileType: true },
    });
    if (!found) throw new AppError("NOT_FOUND");
    await recordAudit(tx, {
      userId: actor.userId,
      action: "document_downloaded",
      resourceType: "candidate_document",
      resourceId: found.id,
    });
    return found;
  });
  const storage = getStorage();
  const url = await storage.signedDownloadUrl(document.storagePath, document.fileName, 60);
  if (url) return { kind: "redirect" as const, url };
  const bytes = await storage.get(document.storagePath);
  return {
    kind: "bytes" as const,
    bytes,
    fileName: document.fileName,
    contentType: MIME_TYPES[document.fileType as SupportedFileType] ?? "application/octet-stream",
  };
}
