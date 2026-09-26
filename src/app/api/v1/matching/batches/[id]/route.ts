import { NextResponse } from "next/server";
import { z } from "zod";
import { getMatchBatch } from "@/modules/matching/batch.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Real progress of one of the caller's match batches (polled by the Matches page). */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const batch = await getMatchBatch(actor, z.uuid().parse(params.id));
  return NextResponse.json({ data: batch }, { headers: { "Cache-Control": "no-store" } });
});
