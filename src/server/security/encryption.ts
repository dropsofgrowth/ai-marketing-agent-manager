import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for third-party credentials stored at rest
 * (IntegrationConnection.encryptedCredentials).
 *
 * Format: "v1.<iv>.<authTag>.<ciphertext>" (base64url segments).
 * `context` is bound as additional authenticated data — pass e.g. the
 * connection id so a ciphertext cannot be copied onto another row.
 */
const VERSION = "v1";
const IV_BYTES = 12;

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).");
  }
  return key;
}

export function encryptSecret(plaintext: string, base64Key: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", parseKey(base64Key), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(token: string, base64Key: string, context: string): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unsupported encrypted secret format.");
  }
  const [, iv, tag, ciphertext] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", parseKey(base64Key), iv);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
