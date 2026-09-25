import { NextResponse } from "next/server";
import { exportCandidateData } from "@/modules/candidate";
import { exportUserJobs } from "@/modules/jobs/jobs.service";
import { route } from "@/server/http";
import { requireActor } from "@/server/session";

export const dynamic = "force-dynamic";

/** Structured JSON export of all candidate data. */
export const GET = route(async () => {
  const actor = await requireActor();
  const data = { ...(await exportCandidateData(actor)), jobs: await exportUserJobs(actor) };
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="jobhunt-os-export-${date}.json"`,
      "cache-control": "private, no-store",
    },
  });
});
