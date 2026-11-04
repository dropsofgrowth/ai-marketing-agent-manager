import "server-only";

import { z } from "zod";

import { decryptSecret, encryptSecret } from "@/server/security/encryption";

/** Bump together with a key-rotation migration. */
export const CREDENTIALS_KEY_VERSION = 1;

const credentialsSchema = z.object({
  v: z.literal(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
});

export type ShopifyCredentials = { accessToken: string; refreshToken: string | null };

/**
 * Additional authenticated data for the ciphertext: binds it to one workspace,
 * provider and shop so it cannot be copied onto another row and still decrypt.
 */
export function credentialsContext(workspaceId: string, shopDomain: string) {
  return `integration_connection:${workspaceId}:SHOPIFY:${shopDomain}`;
}

export function encryptCredentials(credentials: ShopifyCredentials, key: string, context: string): string {
  return encryptSecret(
    JSON.stringify({ v: 1, accessToken: credentials.accessToken, refreshToken: credentials.refreshToken }),
    key,
    context,
  );
}

export function decryptCredentials(ciphertext: string, key: string, context: string): ShopifyCredentials {
  const parsed = credentialsSchema.parse(JSON.parse(decryptSecret(ciphertext, key, context)));
  return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken };
}
