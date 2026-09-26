/**
 * Download file names built from the candidate's own profile name (never hard-coded).
 * Only ASCII letters, digits and underscores survive — no path separators, no reserved
 * characters, bounded length.
 */
function part(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/g, "");
}

export function resumeFileName(input: {
  name: string | null | undefined;
  target?: string | null;
  extension: "pdf" | "docx";
}): string {
  const name = part(input.name, 60) || "Candidate";
  const target = part(input.target, 40);
  return `${[name, "Resume", target].filter(Boolean).join("_")}.${input.extension}`;
}

/** RFC 6266 Content-Disposition value (ASCII fallback + UTF-8). */
export function contentDisposition(fileName: string, inline = false): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
