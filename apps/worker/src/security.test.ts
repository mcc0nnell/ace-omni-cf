import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  assertRuntimeSecrets,
  canonicalJson,
  hashToken,
  signClaims,
  verifyClaims,
} from "./security";

const ClaimsSchema = z.object({
  kind: z.literal("test"),
  subject: z.string(),
  expiresAt: z.number().int(),
});

describe("security boundaries", () => {
  it("cryptographically rejects a modified credential", async () => {
    const secret = "a-secure-test-signing-secret-with-more-than-32-bytes";
    const token = await signClaims(secret, {
      kind: "test",
      subject: "participant-1",
      expiresAt: Date.now() + 1_000,
    });

    await expect(verifyClaims(secret, token, ClaimsSchema)).resolves.toMatchObject({
      subject: "participant-1",
    });

    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(verifyClaims(secret, tampered, ClaimsSchema)).resolves.toBeNull();
  });

  it("uses a canonical representation for signed evidence metadata", () => {
    expect(canonicalJson({ b: 2, nested: { z: true, a: null }, a: 1 })).toBe(
      canonicalJson({ a: 1, nested: { a: null, z: true }, b: 2 }),
    );
  });

  it("hashes opaque tokens without storing the bearer value", async () => {
    await expect(hashToken("secret bearer")).resolves.toMatch(/^[a-f0-9]{64}$/);
    await expect(hashToken("secret bearer")).resolves.toBe(await hashToken("secret bearer"));
  });

  it("fails closed when production secrets are missing or development placeholders", () => {
    expect(() =>
      assertRuntimeSecrets({
        ENVIRONMENT: "production",
        SESSION_SECRET: "local-only-session-secret-32-bytes-minimum-change-me",
        TOKEN_SIGNING_SECRET: "valid-token-signing-secret-with-32-bytes-minimum",
        SCHEDULE_SIGNING_SECRET: "valid-schedule-signing-secret-with-32-bytes-minimum",
      }),
    ).toThrow(/production secret/i);

    expect(() =>
      assertRuntimeSecrets({
        ENVIRONMENT: "development",
        SESSION_SECRET: "local-only",
        TOKEN_SIGNING_SECRET: "local-only",
        SCHEDULE_SIGNING_SECRET: "local-only",
      }),
    ).not.toThrow();
  });
});
