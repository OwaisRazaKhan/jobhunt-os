import { NextResponse } from "next/server";
import { z } from "zod";
import { contentDisposition } from "@/modules/resumes/filename";
import { renderPreviewPdf } from "@/modules/resumes/export.service";
import { PAGE_FORMATS, TEMPLATE_KEYS } from "@/modules/resumes/templates";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/**
 * Exact preview: renders the caller's version with the same PDF renderer used for export and
 * returns it inline (nothing is stored). Optional ?template=&format= try other layouts.
 */
export const GET = route<{ id: string }>(async (request, { params }) => {
  const actor = await requireActor();
  const versionId = z.uuid().parse(params.id);
  const search = new URL(request.url).searchParams;
  const template = z.enum(TEMPLATE_KEYS).nullable().catch(null).parse(search.get("template"));
  const pageFormat = z.enum(PAGE_FORMATS).nullable().catch(null).parse(search.get("format"));
  const pdf = await renderPreviewPdf(actor, versionId, { template, pageFormat });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(pdf.fileName, true),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Resume-Pages": String(pdf.pages),
    },
  });
});
