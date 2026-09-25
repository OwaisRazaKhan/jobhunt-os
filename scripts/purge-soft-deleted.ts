/**
 * Hard-deletes candidate facts soft-deleted more than 30 days ago.
 *   npm run maintenance:purge
 * Run periodically (e.g. a free cron such as a GitHub Actions schedule).
 */
import { purgeSoftDeleted } from "@/modules/candidate/account.service";
import { purgeDeletedJobs } from "@/modules/jobs/jobs.service";
import { getDb } from "@/server/db";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on the process environment
}

Promise.all([purgeSoftDeleted(30), purgeDeletedJobs(30)])
  .then(async ([facts, jobs]) => {
    console.warn(`Purged ${facts} soft-deleted facts and ${jobs} deleted jobs older than 30 days.`);
    await getDb().$disconnect();
  })
  .catch((error) => {
    console.error("Purge failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
