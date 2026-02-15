/**
 * Шифрование API-ключей Fleet в БД (FleetPark.apiKeyEnc).
 * AES-256-GCM; ключ из ENCRYPTION_KEY (32 байта hex или base64) или API_SECRET (будет дополнен до 32 байт).
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 16;
const TAG_LEN = 16;
const SALT_LEN = 16;
const KEY_LEN = 32;

function getEncryptionKey(): Buffer | null {
  const raw = process.env.ENCRYPTION_KEY || process.env.API_SECRET;
  if (!raw || raw.length < 16) return null;
  if (Buffer.isEncoding("hex") && raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return scryptSync(raw, "fleet-park-salt", KEY_LEN);
}

/**
 * Шифрует строку (например API-ключ). Возвращает base64: salt:iv:tag:ciphertext.
 * Если ENCRYPTION_KEY/API_SECRET не задан — возвращает plain (для dev), в проде задайте ключ.
 */
export function encryptPlaintext(plain: string): string {
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY or API_SECRET required in production to encrypt Fleet API keys");
    }
    return `plain:${plain}`;
  }
  const iv = randomBytes(IV_LEN);
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(key, salt, KEY_LEN);
  const cipher = createCipheriv(ALGO, derived, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [salt.toString("base64url"), iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(":");
}

/**
 * Расшифровывает строку из apiKeyEnc. Поддерживает префикс "plain:" (dev).
 */
export function decryptCiphertext(encrypted: string): string {
  if (encrypted.startsWith("plain:")) return encrypted.slice(6);
  const key = getEncryptionKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY or API_SECRET required in production to decrypt Fleet API keys");
    }
    return encrypted.startsWith("plain:") ? encrypted.slice(6) : encrypted;
  }
  const parts = encrypted.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted format");
  const [saltB64, ivB64, tagB64, encB64] = parts;
  const salt = Buffer.from(saltB64, "base64url");
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  const derived = scryptSync(key, salt, KEY_LEN);
  const decipher = createDecipheriv(ALGO, derived, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encB64, "base64url", "utf8") + decipher.final("utf8");
}
