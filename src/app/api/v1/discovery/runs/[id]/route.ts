import { NextResponse } from "next/server";
import { z } from "zod";
import { getDiscoveryRun } from "@/modules/jobs/discovery/run.service";
import { toDiscoveryRunView } from "@/modules/jobs/discovery/run-view";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Real progress of one of the caller's runs (polled by the discovery page). */
export const GET = route<{ id: string }>(async (_request, { params }) => {
  const actor = await requireActor();
  const run = await getDiscoveryRun(actor, z.uuid().parse(params.id));
  return NextResponse.json(
    { data: toDiscoveryRunView(run) },
    { headers: { "Cache-Control": "no-store" } },
  );
});
