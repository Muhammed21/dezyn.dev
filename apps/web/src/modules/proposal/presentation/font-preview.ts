import { z } from "zod";

import { Length } from "./length.ts";
import type { SamplePreview } from "./preview.ts";

const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

const KEYWORD_WEIGHTS: ReadonlyMap<string, number> = new Map([
  ["thin", 100],
  ["hairline", 100],
  ["extra-light", 200],
  ["ultra-light", 200],
  ["light", 300],
  ["normal", 400],
  ["regular", 400],
  ["book", 400],
  ["medium", 500],
  ["semi-bold", 600],
  ["demi-bold", 600],
  ["bold", 700],
  ["extra-bold", 800],
  ["ultra-bold", 800],
  ["black", 900],
  ["heavy", 900],
  ["extra-black", 950],
  ["ultra-black", 950],
]);

const ALIAS = /^\{.*\}$/;

const FamilyName = z
  .string()
  .min(1)
  .refine((name) => !ALIAS.test(name));

const FontFamily = z
  .union([FamilyName.transform((name) => [name]), z.array(FamilyName).min(1)])
  .transform((names) => ({
    text: names.join(", "),
    css: names.map((name) => (GENERIC_FAMILIES.has(name) ? name : JSON.stringify(name))).join(", "),
  }));

const FontWeight = z.union([
  z
    .number()
    .min(1)
    .max(1000)
    .transform((weight) => ({ text: String(weight), css: weight })),
  z
    .string()
    .transform((keyword) => ({ text: keyword, css: KEYWORD_WEIGHTS.get(keyword) }))
    .pipe(z.object({ text: z.string(), css: z.number() })),
]);

const Typography = z.object({
  fontFamily: FontFamily,
  fontSize: Length,
  fontWeight: FontWeight,
  lineHeight: z.number(),
  letterSpacing: Length,
});

export const fontFamilyPreview = (value: unknown): SamplePreview | undefined => {
  const family = FontFamily.safeParse(value);
  if (!family.success) {
    return undefined;
  }
  return { shape: "sample", text: family.data.text, style: { fontFamily: family.data.css } };
};

export const fontWeightPreview = (value: unknown): SamplePreview | undefined => {
  const weight = FontWeight.safeParse(value);
  if (!weight.success) {
    return undefined;
  }
  return { shape: "sample", text: weight.data.text, style: { fontWeight: weight.data.css } };
};

export const typographyPreview = (value: unknown): SamplePreview | undefined => {
  const typography = Typography.safeParse(value);
  if (!typography.success) {
    return undefined;
  }
  const { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } = typography.data;
  return {
    shape: "sample",
    text: [
      fontFamily.text,
      fontSize,
      fontWeight.text,
      `interligne ${lineHeight}`,
      `espacement ${letterSpacing}`,
    ].join(" · "),
    style: {
      fontFamily: fontFamily.css,
      fontSize,
      fontWeight: fontWeight.css,
      lineHeight,
      letterSpacing,
    },
  };
};
