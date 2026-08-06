import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { omniTokens } from "./tokens.generated";

function rgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  if (!/^[a-f0-9]{6}$/i.test(value)) throw new Error(`Expected six-digit hex color, received ${hex}`);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const channels = rgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function token(name: keyof typeof omniTokens, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token reference at ${name}`);
  seen.add(name);
  const value = omniTokens[name];
  const reference = value.match(/^var\((--omni-[a-z0-9-]+)\)$/)?.[1] as keyof typeof omniTokens | undefined;
  return reference ? token(reference, seen) : value;
}

describe("ACE Omni semantic tokens", () => {
  it("keeps generated tokens synchronized with the CSS source", () => {
    const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    const source = css.match(/\/\* TOKEN_SOURCE_START \*\/([\s\S]*?)\/\* TOKEN_SOURCE_END \*\//)?.[1] ?? "";
    const parsed = Object.fromEntries(
      [...source.matchAll(/(--omni-[a-z0-9-]+)\s*:\s*([^;]+);/g)]
        .map((match) => [match[1], match[2].trim()]),
    );
    expect(parsed).toEqual(omniTokens);
  });

  it("defines semantic roles instead of component-specific colors", () => {
    expect(Object.keys(omniTokens)).toEqual(expect.arrayContaining([
      "--omni-color-canvas",
      "--omni-color-surface",
      "--omni-color-text",
      "--omni-color-text-muted",
      "--omni-color-action",
      "--omni-color-danger",
      "--omni-color-focus",
      "--omni-color-caption-canvas",
      "--omni-color-caption-text",
    ]));
  });

  it("meets WCAG AA contrast for critical text pairs in both modes", () => {
    expect(contrast(
      token("--omni-palette-dark-text"),
      token("--omni-palette-dark-canvas"),
    )).toBeGreaterThanOrEqual(4.5);
    expect(contrast(
      token("--omni-palette-light-text"),
      token("--omni-palette-light-canvas"),
    )).toBeGreaterThanOrEqual(4.5);
    expect(contrast(
      token("--omni-color-danger"),
      token("--omni-color-danger-text"),
    )).toBeGreaterThanOrEqual(4.5);
    expect(contrast(
      token("--omni-color-caption-text"),
      token("--omni-color-caption-canvas"),
    )).toBeGreaterThanOrEqual(4.5);
  });

  it("retains broadcast-grade accessibility modes and touch targets", () => {
    const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    expect(token("--omni-touch-target-min")).toBe("2.75rem");
    expect(css).toContain("data-high-contrast=\"true\"");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("forced-colors: active");
  });
});
