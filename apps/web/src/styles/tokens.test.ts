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

  it("uses the Resilience Atlas Canon v4 material palette", () => {
    expect(token("--omni-material-paper")).toBe("#f4f0e6");
    expect(token("--omni-material-cardstock")).toBe("#ede7d9");
    expect(token("--omni-material-kraft")).toBe("#c4a882");
    expect(token("--omni-material-wood")).toBe("#8b7355");
    expect(token("--omni-material-metal")).toBe("#6b6560");
    expect(token("--omni-ink-primary")).toBe("#1c1915");
    expect(token("--omni-ink-stamp-red")).toBe("#8b2e1f");
    expect(token("--omni-ink-stamp-blue")).toBe("#1f3a5f");
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

  it("keeps time and mechanical motion as named design states", () => {
    expect(token("--omni-motion-instant")).toBe("80ms");
    expect(token("--omni-motion-standard")).toBe("280ms");
    expect(token("--omni-motion-deliberate")).toBe("500ms");
    expect(token("--omni-motion-age")).toBe("1000ms");
    expect(Object.keys(omniTokens)).toEqual(expect.arrayContaining([
      "--omni-age-fresh-edge",
      "--omni-age-light-edge",
      "--omni-age-medium-edge",
      "--omni-age-heavy-edge",
    ]));
  });

  it("meets WCAG AA contrast for critical text pairs in both modes", () => {
    expect(contrast(
      token("--omni-palette-dark-text"),
      token("--omni-palette-dark-canvas"),
    )).toBeGreaterThanOrEqual(4.5);
    expect(contrast(
      token("--omni-palette-light-text"),
      token("--omni-palette-light-surface"),
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

  it("retains accessibility, print, forced-color, and reduced-motion paths", () => {
    const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
    expect(token("--omni-touch-target-min")).toBe("2.75rem");
    expect(css).toContain("data-high-contrast=\"true\"");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("forced-colors: active");
    expect(css).toContain("@media print");
  });
});
