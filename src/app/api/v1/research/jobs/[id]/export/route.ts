import { NextResponse } from "next/server";
import { z } from "zod";
import { exportJobResearch } from "@/modules/research/research.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Download the caller's research brief for a job as Markdown or JSON. */
export const GET = route<{ id: string }>(async (request, { params }) => {
  const actor = await requireActor();
  const jobId = z.uuid().parse(params.id);
  const format = z
    .enum(["md", "json"])
    .catch("md")
    .parse(new URL(request.url).searchParams.get("format"));
  const body = await exportJobResearch(actor, jobId, format);
  return new NextResponse(body, {
    headers: {
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="research-${jobId}.${format}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
