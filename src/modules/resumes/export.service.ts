import "server-only";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { parseResumeDocument, type ResumeDocument } from "./document";
import { contentDisposition, resumeFileName } from "./filename";
import { resumeContentHash } from "./hash";
import { renderResumeDocx } from "./render/docx";
import { buildRenderModel } from "./render/layout";
import { renderResumePdf } from "./render/pdf";
import { toWinAnsi } from "./render/text";
import { blockingClaims, type ActorRef } from "./resume.service";

/**
 * Export pipeline: content validation → provenance validation → template validation →
 * render → render validation (parse the produced file back and verify the content) →
 * private storage (user-scoped path) → export record. A failure at any step records a
 * FAILED export and never marks the file as available; resume data is untouched.
 */

export type ExportFormat = "PDF" | "DOCX";
const MIME: Record<ExportFormat, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const SIGNED_URL_SECONDS = 60;

export function exportStorageKey(
  userId: string,
  resumeId: string,
  versionId: string,
  exportId: string,
  format: ExportFormat,
) {
  return `${userId}/resumes/${resumeId}/versions/${versionId}/${exportId}.${format.toLowerCase()}`;
}

async function extractExportText(bytes: Uint8Array, format: ExportFormat): Promise<string> {
  if (format === "PDF") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
}

const squash = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

/** Verifies a rendered file: correct signature, parseable, and it contains the expected content. */
export async function verifyRenderedFile(
  bytes: Uint8Array,
  format: ExportFormat,
  doc: ResumeDocument,
): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];
  if (!bytes.byteLength) problems.push("File is empty.");
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (format === "PDF" && head !== "%PDF-") problems.push("Not a PDF file signature.");
  if (format === "DOCX" && !(bytes[0] === 0x50 && bytes[1] === 0x4b))
    problems.push("Not a DOCX (zip) file signature.");
  if (problems.length) return { ok: false, problems };
  let text = "";
  try {
    text = await extractExportText(bytes, format);
  } catch {
    return { ok: false, problems: ["The file could not be parsed back."] };
  }
  const hay = squash(text);
  const model = buildRenderModel(doc);
  const expect = (label: string, value: string | null | undefined) => {
    if (!value) return;
    const v = squash(format === "PDF" ? toWinAnsi(value) : value);
    if (v && !hay.includes(v)) problems.push(`${label} missing from the file.`);
  };
  expect("Candidate name", model.name);
  for (const s of model.sections) {
    expect(`Section ${s.title}`, s.title);
    for (const e of s.entries ?? []) expect(`Entry ${e.title}`, e.title);
  }
  return { ok: problems.length === 0, problems };
}

export async function exportResumeVersion(
  actor: ActorRef,
  versionId: string,
  format: ExportFormat,
) {
  if (format !== "PDF" && format !== "DOCX")
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Unknown export format." });

  const { version, resume, doc, activeApproval, profileName, targetCompany } =
    await withUserContext(actor.userId, async (t) => {
      const version = await t.resumeVersion.findFirst({
        where: { id: versionId, userId: actor.userId },
        include: {
          resume: true,
          targetJob: { select: { title: true, company: { select: { name: true } } } },
        },
      });
      if (!version) throw new AppError("NOT_FOUND");
      // 1. Content validation — malformed JSON never reaches a renderer.
      let doc: ResumeDocument;
      try {
        doc = parseResumeDocument(version.content);
      } catch {
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: "The resume content failed validation. Open the editor and save it again.",
        });
      }
      if (resumeContentHash(doc) !== version.contentHash)
        throw new AppError("UNKNOWN_ERROR", {
          message: "content hash mismatch",
          publicMessage:
            "The resume content failed an integrity check. Save it again before exporting.",
        });
      const activeApproval = await t.resumeApproval.findFirst({
        where: { versionId: version.id, revokedAt: null },
      });
      return {
        version,
        resume: version.resume,
        doc,
        activeApproval,
        profileName: doc.header.name,
        targetCompany: version.targetJob?.company?.name ?? null,
      };
    });

  // 2. Provenance validation.
  const blocking = blockingClaims(doc);
  if (blocking.length)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `${blocking.length} unsupported statement${blocking.length === 1 ? "" : "s"} must be removed or fixed before exporting.`,
    });
  if (!doc.header.name.trim())
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Add your name to the resume header before exporting.",
    });

  // Idempotency: an identical successful export is reused.
  const reusable = await withUserContext(actor.userId, (t) =>
    t.resumeExport.findFirst({
      where: {
        versionId: version.id,
        userId: actor.userId,
        format,
        status: "SUCCEEDED",
        contentHash: version.contentHash,
        template: resume.template,
        pageFormat: resume.pageFormat,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (reusable) return { export: reusable, reused: true };

  const matchesApproval = Boolean(
    activeApproval && activeApproval.contentHash === version.contentHash,
  );
  const record = await withUserContext(actor.userId, (t) =>
    t.resumeExport.create({
      data: {
        userId: actor.userId,
        versionId: version.id,
        format,
        status: "PENDING",
        template: resume.template,
        pageFormat: resume.pageFormat,
        contentHash: version.contentHash,
        matchesApproval,
      },
    }),
  );
  const fail = async (message: string, cause?: unknown) => {
    logger.warn("resume export failed", {
      exportId: record.id,
      format,
      reason: message,
      error: cause instanceof Error ? cause.name : undefined,
    });
    await withUserContext(actor.userId, async (t) => {
      await t.resumeExport.update({
        where: { id: record.id },
        data: { status: "FAILED", error: message.slice(0, 1000), completedAt: new Date() },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "resume_export_failed",
        resourceType: "resume_export",
        resourceId: record.id,
        metadata: { format, versionId: version.id },
      });
    });
  };

  // 3–5. Render and validate the rendered file.
  let bytes: Uint8Array;
  try {
    const title = `${profileName} — Resume`;
    bytes =
      format === "PDF"
        ? (
            await renderResumePdf(doc, {
              template: resume.template,
              pageFormat: resume.pageFormat,
              title,
            })
          ).bytes
        : await renderResumeDocx(doc, {
            template: resume.template,
            pageFormat: resume.pageFormat,
            title,
          });
  } catch (error) {
    await fail(`${format} generation failed.`, error);
    throw new AppError("UNKNOWN_ERROR", {
      cause: error,
      publicMessage: `${format} generation failed. Your resume data was not lost.`,
    });
  }
  const verified = await verifyRenderedFile(bytes, format, doc);
  if (!verified.ok) {
    await fail(`Render validation failed: ${verified.problems.join(" ")}`);
    throw new AppError("UNKNOWN_ERROR", {
      publicMessage: `${format} generation produced an invalid file (${verified.problems[0]}). Your resume data was not lost.`,
    });
  }

  // 6. Private storage, user-scoped path.
  const key = exportStorageKey(actor.userId, resume.id, version.id, record.id, format);
  try {
    await getStorage().put(key, bytes, MIME[format]);
  } catch (error) {
    await fail("Storage upload failed.", error);
    throw new AppError("EXTERNAL_SERVICE_ERROR", {
      cause: error,
      publicMessage:
        "The file could not be stored, so the export was not completed. Your resume data was not lost.",
    });
  }

  const fileName = resumeFileName({
    name: profileName,
    target: resume.kind === "TAILORED" ? targetCompany : null,
    extension: format === "PDF" ? "pdf" : "docx",
  });
  const done = await withUserContext(actor.userId, async (t) => {
    const updated = await t.resumeExport.update({
      where: { id: record.id },
      data: {
        status: "SUCCEEDED",
        storagePath: key,
        fileName,
        byteSize: bytes.byteLength,
        fileSha256: sha256Hex(bytes),
        completedAt: new Date(),
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "resume_exported",
      resourceType: "resume_export",
      resourceId: record.id,
      metadata: {
        format,
        versionId: version.id,
        bytes: bytes.byteLength,
        contentHash: version.contentHash,
        matchesApproval,
      },
    });
    return updated;
  });
  return { export: done, reused: false };
}

/**
 * Authorized download: the export must belong to the caller (service filter + RLS). Returns a
 * short-lived signed URL (Supabase) or the bytes (local/memory storage).
 */
export async function getExportDownload(actor: ActorRef, exportId: string) {
  const record = await withUserContext(actor.userId, (t) =>
    t.resumeExport.findFirst({
      where: { id: exportId, userId: actor.userId, status: "SUCCEEDED" },
    }),
  );
  if (!record || !record.storagePath || !record.fileName) throw new AppError("NOT_FOUND");
  if (!record.storagePath.startsWith(`${actor.userId}/resumes/`)) throw new AppError("NOT_FOUND");
  const storage = getStorage();
  const url = await storage.signedDownloadUrl(
    record.storagePath,
    record.fileName,
    SIGNED_URL_SECONDS,
  );
  if (url) return { kind: "redirect" as const, url, record };
  const bytes = await storage.get(record.storagePath);
  return {
    kind: "bytes" as const,
    bytes,
    record,
    contentType: MIME[record.format as ExportFormat],
    disposition: contentDisposition(record.fileName),
  };
}

/** Renders a version inline for the exact-PDF preview (not stored). */
export async function renderPreviewPdf(
  actor: ActorRef,
  versionId: string,
  overrides: { template?: string | null; pageFormat?: string | null } = {},
) {
  const { version, resume } = await withUserContext(actor.userId, async (t) => {
    const version = await t.resumeVersion.findFirst({
      where: { id: versionId, userId: actor.userId },
      include: { resume: true },
    });
    if (!version) throw new AppError("NOT_FOUND");
    return { version, resume: version.resume };
  });
  const doc = parseResumeDocument(version.content);
  const result = await renderResumePdf(doc, {
    template: overrides.template ?? resume.template,
    pageFormat: overrides.pageFormat ?? resume.pageFormat,
  });
  return {
    bytes: result.bytes,
    pages: result.pages,
    fileName: resumeFileName({ name: doc.header.name, extension: "pdf" }),
  };
}
