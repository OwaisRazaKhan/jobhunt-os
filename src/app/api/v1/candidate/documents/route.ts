import { NextResponse } from "next/server";
import { after } from "next/server";
import { listDocuments, processDocument, uploadDocument } from "@/modules/candidate";
import { AppError } from "@/server/errors";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Upload a candidate document. Processing continues in the background after the response. */
export const POST = route(async (request, { requestId, log }) => {
  const actor = await requireActor();
  const form = await request.formData().catch(() => {
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Expected a multipart form upload." });
  });
  const file = form.get("file");
  if (!(file instanceof File))
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Choose a file to upload." });
  const document = await uploadDocument(actor, {
    fileName: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    documentType: String(form.get("documentType") ?? "CV_RESUME"),
  });
  const useAi = form.get("useAi") !== "false";
  after(async () => {
    try {
      await processDocument(actor, document.id, { useAi, traceId: requestId });
    } catch (error) {
      log.warn("background processing failed", {
        documentId: document.id,
        code: error instanceof AppError ? error.code : "UNKNOWN",
      });
    }
  });
  return NextResponse.json({ data: { id: document.id, status: document.status } }, { status: 201 });
});

export const GET = route(async () => {
  const actor = await requireActor();
  const documents = await listDocuments(actor);
  return NextResponse.json({ data: documents });
});
