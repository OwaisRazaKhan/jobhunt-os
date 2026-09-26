import { NextResponse } from "next/server";
import { z } from "zod";
import { renderCoverLetterPreview } from "@/modules/communications/export.service";
import { COVER_LETTER_TEMPLATES } from "@/modules/communications/types";
import { contentDisposition } from "@/modules/resumes/filename";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Exact cover-letter preview: same PDF renderer as export, owner only, nothing stored. */
export const GET = route<{ id: string }>(async (request, { params }) => {
  const actor = await requireActor();
  const versionId = z.uuid().parse(params.id);
  const template = z
    .enum(COVER_LETTER_TEMPLATES)
    .nullable()
    .catch(null)
    .parse(new URL(request.url).searchParams.get("template"));
  const pdf = await renderCoverLetterPreview(actor, versionId, { template });
  return new NextResponse(Buffer.from(pdf.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(pdf.fileName, true),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
