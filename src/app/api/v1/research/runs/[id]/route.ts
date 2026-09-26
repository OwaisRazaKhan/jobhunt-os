import { NextResponse } from "next/server";
import { z } from "zod";
import { getRun } from "@/modules/research/research.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Real progress (recorded steps) of one of the caller's research runs. */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const run = await getRun(actor, z.uuid().parse(params.id));
  return NextResponse.json({ data: run }, { headers: { "Cache-Control": "no-store" } });
});
