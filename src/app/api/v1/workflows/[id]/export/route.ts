import { NextResponse } from "next/server";
import { z } from "zod";
import { exportWorkflow } from "@/modules/workflows/workflow.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Downloads a workflow as JSON (owner only; private record ids removed). */
export const GET = route<{ id: string }>(async (request, { params }) => {
  const actor = await requireActor();
  const versionId = new URL(request.url).searchParams.get("version");
  const data = await exportWorkflow(
    actor,
    z.uuid().parse(params.id),
    versionId ? z.uuid().parse(versionId) : null,
  );
  const name = data.name.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) || "workflow";
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.workflow.json"`,
      "Cache-Control": "private, no-store",
    },
  });
});
