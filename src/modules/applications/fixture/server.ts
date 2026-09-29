/**
 * CONTROLLED TEST FIXTURE — a local application form used to test browser automation without sending
 * anything to a real company. It is served on 127.0.0.1 only (npm run fixture:application, or started
 * by the browser tests) and is always labelled TEST in JOBHUNT OS. Submissions stay in memory.
 *
 * Variants (?variant=…): basic · changed (form schema changed) · captcha · login · slow (no confirmation)
 * · reject (server rejects the submission)
 */
import { createServer, type Server } from "node:http";

export const FIXTURE_VARIANTS = ["basic", "changed", "captcha", "login", "slow", "reject"] as const;
export type FixtureVariant = (typeof FIXTURE_VARIANTS)[number];

export interface FixtureSubmission {
  id: string;
  variant: string;
  fields: Record<string, string>;
  files: { field: string; name: string; size: number; type: string }[];
  at: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function renderFixtureForm(variant: FixtureVariant, error?: string): string {
  const changed = variant === "changed";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>TEST FIXTURE — Apply: Frontend Engineer</title></head>
<body>
<main>
<h1>Frontend Engineer — Fixture Co (TEST FIXTURE)</h1>
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
${
  variant === "login"
    ? `<form method="post" action="/login"><label for="user">Email</label><input id="user" name="user" type="email"><label for="pw">Password</label><input id="pw" name="pw" type="password"><button type="submit">Sign in to continue</button></form>`
    : `
<form method="post" action="/submit?variant=${variant}" enctype="multipart/form-data">
  <label for="first_name">First name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <label for="linkedin">LinkedIn profile</label><input id="linkedin" name="linkedin" type="url">
  <label for="location">Current location</label><input id="location" name="location">
  <label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" accept=".pdf,.docx" required>
  <label for="cover_letter">Cover letter</label><input id="cover_letter" name="cover_letter" type="file" accept=".pdf,.docx">
  <fieldset aria-required="true"><legend>Are you legally authorized to work in Germany? *</legend>
    <label><input type="radio" name="work_auth_de" value="yes" required> Yes</label>
    <label><input type="radio" name="work_auth_de" value="no"> No</label>
  </fieldset>
  <label for="why">${changed ? "What excites you about this role? *" : "Why do you want to work on this team? *"}</label>
  <textarea id="why" name="why" maxlength="600" required></textarea>
  <label for="python">How would you rate your Python proficiency?</label>
  <select id="python" name="python"><option value="">Select…</option><option>Beginner</option><option>Intermediate</option><option>Expert</option></select>
  ${changed ? `<label for="salary">Expected salary (annual) *</label><input id="salary" name="salary" required>` : ""}
  <label for="gender">Gender (voluntary self-identification)</label>
  <select id="gender" name="gender"><option value="">Select…</option><option>Woman</option><option>Man</option><option>Non-binary</option><option>Decline to self-identify</option></select>
  <label><input type="checkbox" name="consent" value="yes" required> I certify that the information provided is accurate and I agree to the privacy notice. *</label>
  ${variant === "captcha" ? `<div class="g-recaptcha" data-sitekey="test-fixture-sitekey">CAPTCHA (fixture)</div>` : ""}
  <button type="submit">Submit application</button>
</form>`
}
</main></body></html>`;
}

/** Starts the fixture on 127.0.0.1 (port 0 = random). Returns the origin and recorded submissions. */
export async function startFixtureServer(port = 0): Promise<{
  origin: string;
  submissions: FixtureSubmission[];
  server: Server;
  close: () => Promise<void>;
}> {
  const submissions: FixtureSubmission[] = [];
  let counter = 1000;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const variant = (FIXTURE_VARIANTS as readonly string[]).includes(
      url.searchParams.get("variant") ?? "",
    )
      ? (url.searchParams.get("variant") as FixtureVariant)
      : "basic";
    const html = (status: number, body: string) => {
      res.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
    };
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/apply"))
      return html(200, renderFixtureForm(variant));
    if (req.method === "POST" && url.pathname === "/submit") {
      if (variant === "slow") return; // never answers → the worker must report SUBMISSION_UNCERTAIN
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const request = new Request("http://127.0.0.1/submit", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      });
      const form = await request.formData();
      const fields: Record<string, string> = {};
      const files: FixtureSubmission["files"] = [];
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") fields[key] = value;
        else if (value.size > 0)
          files.push({ field: key, name: value.name, size: value.size, type: value.type });
      }
      const missing = [
        "first_name",
        "last_name",
        "email",
        "work_auth_de",
        "why",
        "consent",
        ...(variant === "changed" ? ["salary"] : []),
      ].filter((k) => !fields[k]);
      if (!files.some((f) => f.field === "resume")) missing.push("resume");
      if (variant === "reject" || missing.length)
        return html(
          422,
          renderFixtureForm(
            variant,
            `Please correct the errors: ${variant === "reject" ? "submission failed" : missing.join(", ")} is required.`,
          ),
        );
      const id = `FIX-${++counter}`;
      submissions.push({ id, variant, fields, files, at: new Date().toISOString() });
      return html(
        200,
        `<!doctype html><html><head><title>Application received (TEST FIXTURE)</title></head><body><main><h1>Thank you for applying!</h1><p>Your application has been received. Application ID: ${id}</p></main></body></html>`,
      );
    }
    html(404, "<p>Not found</p>");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  return {
    origin: `http://127.0.0.1:${address.port}`,
    submissions,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
