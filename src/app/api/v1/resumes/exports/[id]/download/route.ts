import { NextResponse } from "next/server";
import { z } from "zod";
import { getExportDownload } from "@/modules/resumes/export.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Authorized download of an exported resume file. Ownership is checked (service + RLS) before a
 * 60-second signed URL is issued; another user's export id returns 404.
 */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const exportId = z.uuid().parse(params.id);
  const file = await getExportDownload(actor, exportId);
  if (file.kind === "redirect") {
    return NextResponse.redirect(file.url, {
      status: 302,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new NextResponse(Buffer.from(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": file.disposition,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
