import { NextResponse } from "next/server";
import { z } from "zod";
import { getDocumentStatus } from "@/modules/candidate";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Processing status (polled by the uploader). Never returns document content. */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const status = await getDocumentStatus(actor, z.uuid().parse(params.id));
  return NextResponse.json({ data: status });
});
