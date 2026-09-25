import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocumentDownload } from "@/modules/candidate";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

function contentDisposition(fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Ownership-checked download: short-lived signed URL (Supabase) or streamed bytes (local dev). */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const result = await getDocumentDownload(actor, z.uuid().parse(params.id));
  if (result.kind === "redirect")
    return NextResponse.redirect(result.url, {
      status: 302,
      headers: { "cache-control": "no-store" },
    });
  return new NextResponse(Buffer.from(result.bytes), {
    headers: {
      "content-type": result.contentType,
      "content-disposition": contentDisposition(result.fileName),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
