/**
 * Cloudflare Web Crypto primitives for server-managed ACE Omni identity,
 * signed coordination metadata, and tamper-evident evidence.
 * ©2024 The MITRE Corporation. Approved for Public Release 24-0463.
 */
import type { ZodType } from "zod";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 210_000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function canonicalJson(value: unknown): string {
  const normalize = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(normalize);
    if (current && typeof current === "object") {
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)]),
      );
    }
    return current;
  };
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(value: string | ArrayBuffer | ArrayBufferView): Promise<string> {
  let data: Uint8Array;
  if (typeof value === "string") {
    data = encoder.encode(value);
  } else if (value instanceof ArrayBuffer) {
    data = new Uint8Array(value);
  } else {
    data = new Uint8Array(value.byteLength);
    data.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const actualSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: actualSalt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(actualSalt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algorithm, iterationsText, saltText, expectedText] = stored.split("$");
    if (algorithm !== "pbkdf2-sha256" || !saltText || !expectedText) return false;
    const iterations = Number(iterationsText);
    if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const salt = base64UrlToBytes(saltText);
    const expected = base64UrlToBytes(expectedText);
    if (!salt || !expected || salt.length !== 16 || expected.length !== 32) return false;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const actual = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
        keyMaterial,
        256,
      ),
    );
    return timingSafeBytesEqual(actual, expected);
  } catch {
    return false;
  }
}

async function importHmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmacKey(secret, "sign"),
    encoder.encode(message),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const bytes = base64UrlToBytes(signature);
  if (!bytes || bytes.length !== 32) return false;
  return crypto.subtle.verify(
    "HMAC",
    await importHmacKey(secret, "verify"),
    bytes,
    encoder.encode(message),
  );
}

export async function signClaims(secret: string, claims: unknown): Promise<string> {
  const body = bytesToBase64Url(encoder.encode(canonicalJson(claims)));
  const protectedValue = `v1.${body}`;
  return `${protectedValue}.${await hmacSign(secret, protectedValue)}`;
}

export async function verifyClaims<T>(
  secret: string,
  token: string,
  schema: ZodType<T>,
  now = Date.now(),
): Promise<T | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const protectedValue = `${parts[0]}.${parts[1]}`;
  if (!(await hmacVerify(secret, protectedValue, parts[2]))) return null;
  const payload = base64UrlToBytes(parts[1]);
  if (!payload) return null;

  try {
    const parsed = schema.safeParse(JSON.parse(decoder.decode(payload)));
    if (!parsed.success) return null;
    const expiring = parsed.data as { expiresAt?: unknown };
    if (typeof expiring.expiresAt === "number" && expiring.expiresAt <= now) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function createToken(bytes = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

interface RuntimeSecrets {
  ENVIRONMENT: string;
  SESSION_SECRET?: string;
  TOKEN_SIGNING_SECRET?: string;
  SCHEDULE_SIGNING_SECRET?: string;
}

export function assertRuntimeSecrets(environment: RuntimeSecrets): void {
  if (environment.ENVIRONMENT !== "production") return;
  const secrets = [
    ["SESSION_SECRET", environment.SESSION_SECRET],
    ["TOKEN_SIGNING_SECRET", environment.TOKEN_SIGNING_SECRET],
    ["SCHEDULE_SIGNING_SECRET", environment.SCHEDULE_SIGNING_SECRET],
  ] as const;

  for (const [name, value] of secrets) {
    if (
      !value ||
      value.length < 32 ||
      /(local-only|change-me|development|dev-secret|example|replace-me)/i.test(value)
    ) {
      throw new Error(`Invalid production secret: ${name}`);
    }
  }
}
