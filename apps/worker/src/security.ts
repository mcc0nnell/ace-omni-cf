/**
 * Security utilities compatible with Cloudflare Workers.
 * Password hashing uses Web Crypto (PBKDF2).
 */

const encoder = new TextEncoder();

export async function hashPassword(password: string, salt?: Uint8Array): Promise<string> {
  const s = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: s,
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  const hash = new Uint8Array(derived);
  const combined = new Uint8Array(s.length + hash.length);
  combined.set(s);
  combined.set(hash, s.length);
  return btoa(String.fromCharCode(...combined));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const expected = combined.slice(16);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt,
        iterations: 100_000,
        hash: "SHA-256",
      },
      keyMaterial,
      256
    );
    const actual = new Uint8Array(derived);
    if (actual.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function hmacVerify(
  secret: string,
  message: string,
  signature: string
): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function createToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function hashToken(token: string): Promise<string> {
  const data = encoder.encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
