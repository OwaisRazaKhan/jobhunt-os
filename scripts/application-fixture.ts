/**
 * Local CONTROLLED TEST application form (never a real company). Use it to try browser automation:
 *
 *   npm run fixture:application          # serves http://127.0.0.1:4010/apply?variant=basic
 *
 * Set APPLICATION_FIXTURE_ORIGIN=http://127.0.0.1:4010 in .env (development only) so the worker's
 * navigation guard trusts this one local origin. Variants: basic, changed, captcha, login, slow, reject.
 */
import { startFixtureServer } from "../src/modules/applications/fixture/server";

async function main() {
  const port = Number(process.env.APPLICATION_FIXTURE_PORT) || 4010;
  const fixture = await startFixtureServer(port);
  console.warn(
    `TEST FIXTURE application form on ${fixture.origin}/apply?variant=basic (Ctrl+C to stop)`,
  );
  setInterval(() => {
    if (fixture.submissions.length)
      console.warn(
        `fixture submissions so far: ${fixture.submissions.map((s) => s.id).join(", ")}`,
      );
  }, 30_000);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
