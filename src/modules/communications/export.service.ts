import "server-only";
import { contentDisposition } from "@/modules/resumes/filename";
import { toWinAnsi } from "@/modules/resumes/render/text";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { runCommunicationCheck, type ActorRef } from "./communication.service";
import { parseCommunicationDocument, toPlainText, type CommunicationDocument } from "./document";
import { communicationContentHash } from "./hash";
import { renderCoverLetterDocx } from "./render/docx";
import { buildLetterModel, renderLetterPlainText } from "./render/layout";
import { renderCoverLetterPdf } from "./render/pdf";

/**
 * Export pipeline (mirrors Resume Studio): content + integrity validation → claim validation
 * (no unsupported statements) → render → parse the file back and verify its content →
 * private storage under `{userId}/communications/{communicationId}/versions/{versionId}/` →
 * export record. Emails export as plain text only; nothing is ever sent.
 */

export const COMMUNICATION_EXPORT_FORMATS = ["PDF", "DOCX", "TXT"] as const;
export type CommunicationExportFormat = (typeof COMMUNICATION_EXPORT_FORMATS)[number];
const MIME: Record<CommunicationExportFormat, string> = {
  PDF: "application/pdf",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  TXT: "text/plain; charset=utf-8",
};
export const SIGNED_URL_SECONDS = 60;

export function communicationExportKey(
  userId: string,
  communicationId: string,
  versionId: string,
  exportId: string,
  format: CommunicationExportFormat,
) {
  return `${userId}/communications/${communicationId}/versions/${versionId}/${exportId}.${format.toLowerCase()}`;
}

function part(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/g, "");
}

export function communicationFileName(input: {
  name: string | null;
  kind: "EMAIL" | "COVER_LETTER";
  target: string | null;
  extension: string;
}) {
  const name = part(input.name, 60) || "Candidate";
  return `${[name, input.kind === "EMAIL" ? "Email" : "Cover_Letter", part(input.target, 40)].filter(Boolean).join("_")}.${input.extension}`;
}

const squash = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLowerCase();

async function extractText(bytes: Uint8Array, format: CommunicationExportFormat): Promise<string> {
  if (format === "PDF") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await pdfText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (format === "DOCX") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Parses the produced file back and checks the signature and every paragraph are present. */
export async function verifyCommunicationFile(
  bytes: Uint8Array,
  format: CommunicationExportFormat,
  doc: CommunicationDocument,
) {
  const problems: string[] = [];
  if (!bytes.byteLength) problems.push("File is empty.");
  const head = Buffer.from(bytes.slice(0, 5)).toString("latin1");
  if (format === "PDF" && head !== "%PDF-") problems.push("Not a PDF file signature.");
  if (format === "DOCX" && !(bytes[0] === 0x50 && bytes[1] === 0x4b))
    problems.push("Not a DOCX (zip) file signature.");
  if (problems.length) return { ok: false, problems };
  let text = "";
  try {
    text = await extractText(bytes, format);
  } catch {
    return { ok: false, problems: ["The file could not be parsed back."] };
  }
  const hay = squash(text);
  const expect = (label: string, value: string | null | undefined) => {
    if (!value) return;
    const v = squash(format === "PDF" ? toWinAnsi(value) : value);
    if (v && !hay.includes(v)) problems.push(`${label} missing from the file.`);
  };
  expect("Greeting", doc.greeting);
  (doc.kind === "EMAIL" ? doc.bodyParagraphs : doc.paragraphs).forEach((p, i) =>
    expect(`Paragraph ${i + 1}`, p),
  );
  expect("Signature", doc.signature.split("\n")[0]);
  return { ok: problems.length === 0, problems };
}

export async function exportCommunicationVersion(
  actor: ActorRef,
  versionId: string,
  format: CommunicationExportFormat,
) {
  if (!(COMMUNICATION_EXPORT_FORMATS as readonly string[]).includes(format))
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Unknown export format." });

  const { version, communication, doc, activeApproval, targetCompany } = await withUserContext(
    actor.userId,
    async (t) => {
      const version = await t.communicationVersion.findFirst({
        where: { id: versionId, userId: actor.userId },
        include: { communication: { include: { company: { select: { name: true } } } } },
      });
      if (!version) throw new AppError("NOT_FOUND");
      let doc: CommunicationDocument;
      try {
        doc = parseCommunicationDocument(version.content);
      } catch {
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: "The content failed validation. Open the editor and save it again.",
        });
      }
      if (communicationContentHash(doc) !== version.contentHash)
        throw new AppError("UNKNOWN_ERROR", {
          message: "content hash mismatch",
          publicMessage: "The content failed an integrity check. Save it again before exporting.",
        });
      const activeApproval = await t.communicationApproval.findFirst({
        where: { versionId: version.id, revokedAt: null },
      });
      return {
        version,
        communication: version.communication,
        doc,
        activeApproval,
        targetCompany:
          version.communication.company?.name ?? version.communication.recipientCompany,
      };
    },
  );
  if (doc.kind === "EMAIL" && format !== "TXT")
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Emails export as plain text. Copy the text or download the .txt file.",
    });

  // Claim validation on the exact content (reuses a current check).
  const { check } = await runCommunicationCheck(actor, version.id);
  const unsupported = await withUserContext(actor.userId, (t) =>
    t.communicationClaim.count({ where: { versionId: version.id, status: "UNSUPPORTED" } }),
  );
  if (unsupported)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `${unsupported} unsupported statement${unsupported === 1 ? "" : "s"} must be removed or fixed before exporting.`,
    });

  const template = communication.template;
  const pageFormat = communication.pageFormat;
  const reusable = await withUserContext(actor.userId, (t) =>
    t.communicationExport.findFirst({
      where: {
        versionId: version.id,
        userId: actor.userId,
        format,
        status: "SUCCEEDED",
        contentHash: version.contentHash,
        template,
        pageFormat,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (reusable) return { export: reusable, reused: true };

  const matchesApproval = Boolean(
    activeApproval && activeApproval.contentHash === version.contentHash,
  );
  const record = await withUserContext(actor.userId, (t) =>
    t.communicationExport.create({
      data: {
        userId: actor.userId,
        versionId: version.id,
        format,
        status: "PENDING",
        template,
        pageFormat,
        contentHash: version.contentHash,
        matchesApproval,
      },
    }),
  );
  const fail = async (message: string, cause?: unknown) => {
    logger.warn("communication export failed", {
      exportId: record.id,
      format,
      reason: message,
      error: cause instanceof Error ? cause.name : undefined,
    });
    await withUserContext(actor.userId, async (t) => {
      await t.communicationExport.update({
        where: { id: record.id },
        data: { status: "FAILED", error: message.slice(0, 1000), completedAt: new Date() },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "communication_export_failed",
        resourceType: "communication_export",
        resourceId: record.id,
        metadata: { format, versionId: version.id },
      });
    });
  };

  const signer =
    doc.kind === "COVER_LETTER"
      ? (doc.header.name ?? doc.signature.split("\n")[0] ?? null)
      : (doc.signature.split("\n")[0] ?? null);
  let bytes: Uint8Array;
  try {
    if (doc.kind === "COVER_LETTER" && format === "PDF")
      bytes = (await renderCoverLetterPdf(doc, { template, pageFormat })).bytes;
    else if (doc.kind === "COVER_LETTER" && format === "DOCX")
      bytes = await renderCoverLetterDocx(doc, { template, pageFormat });
    else
      bytes = new TextEncoder().encode(
        doc.kind === "COVER_LETTER"
          ? renderLetterPlainText(buildLetterModel(doc))
          : toPlainText(doc),
      );
  } catch (error) {
    await fail(`${format} generation failed.`, error);
    throw new AppError("UNKNOWN_ERROR", {
      cause: error,
      publicMessage: `${format} generation failed. Your content was not lost.`,
    });
  }
  const verified = await verifyCommunicationFile(bytes, format, doc);
  if (!verified.ok) {
    await fail(`Render validation failed: ${verified.problems.join(" ")}`);
    throw new AppError("UNKNOWN_ERROR", {
      publicMessage: `${format} generation produced an invalid file (${verified.problems[0]}). Your content was not lost.`,
    });
  }
  const key = communicationExportKey(actor.userId, communication.id, version.id, record.id, format);
  try {
    await getStorage().put(key, bytes, MIME[format]);
  } catch (error) {
    await fail("Storage upload failed.", error);
    throw new AppError("EXTERNAL_SERVICE_ERROR", {
      cause: error,
      publicMessage:
        "The file could not be stored, so the export was not completed. Your content was not lost.",
    });
  }
  const fileName = communicationFileName({
    name: signer,
    kind: doc.kind,
    target: targetCompany ?? null,
    extension: format.toLowerCase(),
  });
  const done = await withUserContext(actor.userId, async (t) => {
    const updated = await t.communicationExport.update({
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
      action: "communication_exported",
      resourceType: "communication_export",
      resourceId: record.id,
      metadata: {
        format,
        versionId: version.id,
        bytes: bytes.byteLength,
        contentHash: version.contentHash,
        matchesApproval,
        checkId: check.id,
      },
    });
    return updated;
  });
  return { export: done, reused: false };
}

/** Authorized download (owner only; short-lived signed URL or bytes). */
export async function getCommunicationExportDownload(actor: ActorRef, exportId: string) {
  const record = await withUserContext(actor.userId, (t) =>
    t.communicationExport.findFirst({
      where: { id: exportId, userId: actor.userId, status: "SUCCEEDED" },
    }),
  );
  if (!record || !record.storagePath || !record.fileName) throw new AppError("NOT_FOUND");
  if (!record.storagePath.startsWith(`${actor.userId}/communications/`))
    throw new AppError("NOT_FOUND");
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
    contentType: MIME[record.format as CommunicationExportFormat],
    disposition: contentDisposition(record.fileName),
  };
}

/** Exact PDF preview of a cover-letter version (same renderer as export; nothing stored). */
export async function renderCoverLetterPreview(
  actor: ActorRef,
  versionId: string,
  overrides: { template?: string | null } = {},
) {
  const { version, communication } = await withUserContext(actor.userId, async (t) => {
    const version = await t.communicationVersion.findFirst({
      where: { id: versionId, userId: actor.userId },
      include: { communication: true },
    });
    if (!version) throw new AppError("NOT_FOUND");
    return { version, communication: version.communication };
  });
  const doc = parseCommunicationDocument(version.content);
  if (doc.kind !== "COVER_LETTER")
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Only cover letters have a PDF preview.",
    });
  const result = await renderCoverLetterPdf(doc, {
    template: overrides.template ?? communication.template,
    pageFormat: communication.pageFormat,
  });
  return {
    ...result,
    fileName: communicationFileName({
      name: doc.header.name,
      kind: "COVER_LETTER",
      target: null,
      extension: "pdf",
    }),
  };
}
