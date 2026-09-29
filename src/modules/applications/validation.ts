/**
 * Field-value validation before anything is filled or submitted (pure). Invalid data is never
 * submitted: every problem is reported with a reason; nothing is silently truncated or coerced.
 */
import type { FieldType } from "./types";

export interface FieldSpec {
  label: string;
  fieldType: FieldType;
  required: boolean;
  options?: string[];
  maxLength?: number | null;
}

export interface FileValue {
  kind: "file";
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  /** Hash recorded when the asset was approved (must match) */
  approvedSha256: string;
  ownedByUser: boolean;
}

export type FieldValue = string | string[] | boolean | number | FileValue | null;

export interface ValidationIssue {
  code:
    | "REQUIRED"
    | "EMAIL"
    | "PHONE"
    | "URL"
    | "NUMBER"
    | "DATE"
    | "OPTION"
    | "MAX_LENGTH"
    | "FILE_TYPE"
    | "FILE_SIZE"
    | "FILE_HASH"
    | "FILE_OWNER"
    | "TYPE";
  message: string;
}

export const ALLOWED_UPLOAD_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/plain": [".txt"],
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
/** International phone: optional +, 7–15 digits, common separators. */
const PHONE = /^\+?[\d\s().-]{7,20}$/;

export function isEmpty(value: FieldValue): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim()) ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function validateFieldValue(spec: FieldSpec, value: FieldValue): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isEmpty(value)) {
    if (spec.required) issues.push({ code: "REQUIRED", message: `${spec.label} is required.` });
    return issues;
  }
  const str = typeof value === "string" ? value.trim() : null;
  switch (spec.fieldType) {
    case "EMAIL":
      if (!str || !EMAIL.test(str) || str.length > 254)
        issues.push({ code: "EMAIL", message: `${spec.label}: not a valid email address.` });
      break;
    case "PHONE": {
      const digits = (str ?? "").replace(/\D/g, "");
      if (!str || !PHONE.test(str) || digits.length < 7 || digits.length > 15)
        issues.push({ code: "PHONE", message: `${spec.label}: not a valid phone number.` });
      break;
    }
    case "URL":
      try {
        const u = new URL(str ?? "");
        if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
      } catch {
        issues.push({ code: "URL", message: `${spec.label}: use a full http(s) link.` });
      }
      break;
    case "NUMBER":
      if (typeof value !== "number" && !(str && /^-?\d+(\.\d+)?$/.test(str)))
        issues.push({ code: "NUMBER", message: `${spec.label}: must be a number.` });
      break;
    case "DATE":
      if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str) || Number.isNaN(Date.parse(str)))
        issues.push({ code: "DATE", message: `${spec.label}: use a date (YYYY-MM-DD).` });
      break;
    case "SELECT":
    case "RADIO":
    case "YES_NO":
      if (!str || (spec.options?.length && !spec.options.includes(str)))
        issues.push({
          code: "OPTION",
          message: `${spec.label}: choose one of the offered options.`,
        });
      break;
    case "MULTISELECT":
      if (
        !Array.isArray(value) ||
        (spec.options?.length && value.some((v) => !spec.options!.includes(v)))
      )
        issues.push({ code: "OPTION", message: `${spec.label}: choose from the offered options.` });
      break;
    case "CHECKBOX":
      if (typeof value !== "boolean")
        issues.push({ code: "TYPE", message: `${spec.label}: must be checked or unchecked.` });
      break;
    case "FILE":
      issues.push(...validateFile(spec.label, value));
      break;
    default:
      if (typeof value !== "string")
        issues.push({ code: "TYPE", message: `${spec.label}: expected text.` });
  }
  if (str && spec.maxLength && str.length > spec.maxLength)
    issues.push({
      code: "MAX_LENGTH",
      message: `${spec.label}: ${str.length} characters, the limit is ${spec.maxLength}.`,
    });
  return issues;
}

function validateFile(label: string, value: FieldValue): ValidationIssue[] {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.kind !== "file")
    return [{ code: "TYPE", message: `${label}: expected an approved file.` }];
  const issues: ValidationIssue[] = [];
  const ext = value.fileName.toLowerCase().slice(value.fileName.lastIndexOf("."));
  if (!ALLOWED_UPLOAD_TYPES[value.mimeType]?.includes(ext))
    issues.push({
      code: "FILE_TYPE",
      message: `${label}: ${value.fileName} is not an allowed document type.`,
    });
  if (value.byteSize <= 0 || value.byteSize > MAX_UPLOAD_BYTES)
    issues.push({
      code: "FILE_SIZE",
      message: `${label}: file size must be between 1 byte and 10 MB.`,
    });
  if (!/^[0-9a-f]{64}$/.test(value.sha256) || value.sha256 !== value.approvedSha256)
    issues.push({
      code: "FILE_HASH",
      message: `${label}: the file no longer matches the approved version.`,
    });
  if (!value.ownedByUser)
    issues.push({ code: "FILE_OWNER", message: `${label}: the file does not belong to you.` });
  return issues;
}
