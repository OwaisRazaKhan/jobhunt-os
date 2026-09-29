import "server-only";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportCommunicationVersion } from "@/modules/communications/export.service";
import { exportResumeVersion } from "@/modules/resumes/export.service";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { getStorage } from "@/server/storage";
import type { ActorRef } from "./application.service";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "./validation";

/**
 * Application documents: the EXACT approved files of the locked package versions.
 *  - resume → PDF export of the approved resume version; cover letter → PDF export of the approved
 *    cover-letter version (exports are rendered from the approved content, never regenerated wording)
 *  - verified before use: owned, export content hash == approved version hash, export matches the
 *    approval, stored bytes hash == recorded file hash, type/size allowed
 */

export interface ApplicationFile {
  role: "RESUME" | "COVER_LETTER";
  exportId: string;
  versionId: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  approvedContentHash: string;
  storagePath: string;
  kind: "resume" | "communication";
}

interface Snapshot {
  resume?: { versionId: string; contentHash: string } | null;
  coverLetter?: { versionId: string; contentHash: string } | null;
}

async function findResumeExport(actor: ActorRef, versionId: string, contentHash: string) {
  return withUserContext(actor.userId, (t) =>
    t.resumeExport.findFirst({
      where: {
        userId: actor.userId,
        versionId,
        format: "PDF",
        status: "SUCCEEDED",
        contentHash,
        matchesApproval: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}
async function findCommunicationExport(actor: ActorRef, versionId: string, contentHash: string) {
  return withUserContext(actor.userId, (t) =>
    t.communicationExport.findFirst({
      where: {
        userId: actor.userId,
        versionId,
        format: "PDF",
        status: "SUCCEEDED",
        contentHash,
        matchesApproval: true,
      },
      orderBy: { createdAt: "desc" },
    }),
  );
}

/** Resolves (and with `create`, exports) the approved files for an application. */
export async function resolveApplicationFiles(
  actor: ActorRef,
  applicationId: string,
  opts: { create?: boolean } = {},
): Promise<ApplicationFile[]> {
  const app = await withUserContext(actor.userId, (t) =>
    t.application.findFirst({ where: { id: applicationId, userId: actor.userId } }),
  );
  if (!app) throw new AppError("NOT_FOUND");
  const snap = app.snapshot as Snapshot;
  const out: ApplicationFile[] = [];
  if (snap.resume) {
    let e = await findResumeExport(actor, snap.resume.versionId, snap.resume.contentHash);
    if (!e && opts.create) {
      await exportResumeVersion(actor, snap.resume.versionId, "PDF");
      e = await findResumeExport(actor, snap.resume.versionId, snap.resume.contentHash);
    }
    if (e?.storagePath && e.fileName && e.byteSize && e.fileSha256)
      out.push({
        role: "RESUME",
        exportId: e.id,
        versionId: e.versionId,
        fileName: e.fileName,
        mimeType: "application/pdf",
        byteSize: e.byteSize,
        sha256: e.fileSha256,
        approvedContentHash: snap.resume.contentHash,
        storagePath: e.storagePath,
        kind: "resume",
      });
  }
  if (snap.coverLetter) {
    let e = await findCommunicationExport(
      actor,
      snap.coverLetter.versionId,
      snap.coverLetter.contentHash,
    );
    if (!e && opts.create) {
      await exportCommunicationVersion(actor, snap.coverLetter.versionId, "PDF");
      e = await findCommunicationExport(
        actor,
        snap.coverLetter.versionId,
        snap.coverLetter.contentHash,
      );
    }
    if (e?.storagePath && e.fileName && e.byteSize && e.fileSha256)
      out.push({
        role: "COVER_LETTER",
        exportId: e.id,
        versionId: e.versionId,
        fileName: e.fileName,
        mimeType: "application/pdf",
        byteSize: e.byteSize,
        sha256: e.fileSha256,
        approvedContentHash: snap.coverLetter.contentHash,
        storagePath: e.storagePath,
        kind: "communication",
      });
  }
  return out;
}

/** Verifies a file before upload; returns the problem or null. */
export async function verifyApplicationFile(
  actor: ActorRef,
  file: ApplicationFile,
): Promise<string | null> {
  if (!file.storagePath.startsWith(`${actor.userId}/`)) return "The file does not belong to you.";
  if (
    !ALLOWED_UPLOAD_TYPES[file.mimeType]?.some((ext) => file.fileName.toLowerCase().endsWith(ext))
  )
    return "The file type is not allowed.";
  if (file.byteSize <= 0 || file.byteSize > MAX_UPLOAD_BYTES)
    return "The file size is not allowed.";
  // The approved version must still be approved with the same content hash.
  const approved = await withUserContext(actor.userId, async (t) => {
    if (file.kind === "resume") {
      const v = await t.resumeVersion.findFirst({
        where: { id: file.versionId, userId: actor.userId },
        include: { approvals: { where: { revokedAt: null } } },
      });
      return Boolean(
        v &&
        v.status === "APPROVED" &&
        v.contentHash === file.approvedContentHash &&
        v.approvals.some((a) => a.contentHash === v.contentHash),
      );
    }
    const v = await t.communicationVersion.findFirst({
      where: { id: file.versionId, userId: actor.userId },
      include: { approvals: { where: { revokedAt: null } } },
    });
    return Boolean(
      v &&
      v.status === "APPROVED" &&
      v.contentHash === file.approvedContentHash &&
      v.approvals.some((a) => a.contentHash === v.contentHash),
    );
  });
  if (!approved)
    return "The document is no longer the approved version — approve a new version and update the package.";
  return null;
}

/**
 * Writes verified files to a private temp directory for the browser upload; the caller must call
 * `cleanup` (always, in finally). Stored bytes must hash to the recorded file hash.
 */
export async function materializeFiles(actor: ActorRef, files: ApplicationFile[]) {
  const dir = await mkdtemp(join(tmpdir(), "jobhunt-app-"));
  const paths = new Map<string, string>();
  try {
    for (const f of files) {
      const problem = await verifyApplicationFile(actor, f);
      if (problem)
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: `${f.role === "RESUME" ? "Resume" : "Cover letter"}: ${problem}`,
        });
      const bytes = await getStorage().get(f.storagePath);
      if (sha256Hex(bytes) !== f.sha256)
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: `${f.fileName} changed since it was exported — it will not be uploaded.`,
        });
      const path = join(dir, f.fileName.replace(/[^A-Za-z0-9._-]/g, "_"));
      await writeFile(path, bytes);
      paths.set(f.role, path);
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { paths, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
