/**
 * Creates (or hardens) the private Supabase Storage bucket for candidate documents.
 *   npm run storage:setup
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env. Idempotent.
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on the process environment
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "candidate-documents";
const maxBytes = Number(process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024);

const options = {
  public: false,
  fileSizeLimit: maxBytes,
  allowedMimeTypes: [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ],
};

async function main() {
  if (!url || !key) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (see .env.example).");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (existing) {
    const { error } = await supabase.storage.updateBucket(bucket, options);
    if (error) throw error;
    console.warn(
      `Bucket "${bucket}" exists — enforced private access, ${maxBytes} byte limit and PDF/DOCX/TXT only.`,
    );
  } else {
    const { error } = await supabase.storage.createBucket(bucket, options);
    if (error) throw error;
    console.warn(`Created private bucket "${bucket}".`);
  }
  console.warn(
    "No storage policies are created: only the server (service role) can read or write objects.",
  );
}

main().catch((error) => {
  console.error("Storage setup failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
