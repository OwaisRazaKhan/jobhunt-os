import "server-only";
import { AppError } from "@/server/errors";

export type SupportedFileType = "pdf" | "docx" | "txt";

export const MIME_TYPES: Record<SupportedFileType, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

const MAX_TEXT_CHARS = 200_000;

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, i) => bytes[i] === byte);
}

/**
 * Determine the real file type from content, not the client's claim.
 * The extension must agree with the sniffed type.
 */
export function sniffFileType(bytes: Uint8Array, fileName: string): SupportedFileType | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return ext === "pdf" ? "pdf" : null; // %PDF-
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return ext === "docx" ? "docx" : null; // ZIP container
  if (ext === "txt" && looksLikeText(bytes)) return "txt";
  return null;
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, 64 * 1024));
    return true;
  } catch {
    return false;
  }
}

export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
}

function extractionFailed(code: string, publicMessage: string, cause?: unknown) {
  return new AppError("VALIDATION_ERROR", { message: code, publicMessage, cause });
}

export const EXTRACTION_ERRORS = {
  EMPTY_TEXT:
    "No readable text was found. The file may be a scanned image — try a text-based PDF, DOCX or TXT.",
  PARSE_FAILED: "This file could not be read. It may be damaged or password-protected.",
} as const;

export async function extractText(bytes: Uint8Array, type: SupportedFileType): Promise<string> {
  let raw: string;
  try {
    if (type === "pdf") {
      const { extractText: extractPdf, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractPdf(pdf, { mergePages: false });
      raw = (result.text as string[]).join("\n\n");
    } else if (type === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      raw = result.value;
    } else {
      raw = new TextDecoder("utf-8").decode(bytes);
    }
  } catch (error) {
    throw extractionFailed("PARSE_FAILED", EXTRACTION_ERRORS.PARSE_FAILED, error);
  }
  const text = normalizeText(raw);
  if (text.replace(/\s/g, "").length < 20) {
    throw extractionFailed("EMPTY_TEXT", EXTRACTION_ERRORS.EMPTY_TEXT);
  }
  return text;
}
