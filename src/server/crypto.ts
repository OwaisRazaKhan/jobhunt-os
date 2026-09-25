import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/config/env";
import { AppError } from "./errors";

/**
 * AES-256-GCM field encryption for contact details stored at rest.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
const VERSION = "v1";

function key(): Buffer {
  const raw = getServerEnv().ENCRYPTION_KEY;
  if (!raw) {
    throw new AppError("UNKNOWN_ERROR", {
      message: "ENCRYPTION_KEY is not configured",
      publicMessage: "Server encryption is not configured. See docs/setup.md.",
    });
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new AppError("UNKNOWN_ERROR", { message: "ENCRYPTION_KEY must be 32 bytes (base64)" });
  }
  return buf;
}

export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

export function decryptField(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !data) {
    throw new AppError("UNKNOWN_ERROR", { message: "Unsupported ciphertext format" });
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}
