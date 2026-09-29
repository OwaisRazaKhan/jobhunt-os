import { NextResponse } from "next/server";
import { z } from "zod";
import { getExecutionState } from "@/modules/applications/execution.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Live execution state for the application page (owner only; read-only; no session data). */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const state = await getExecutionState(actor, z.uuid().parse(params.id));
  return NextResponse.json({ data: state }, { headers: { "Cache-Control": "private, no-store" } });
});
