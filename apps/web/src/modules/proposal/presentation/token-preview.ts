import { colorPreview } from "./color-preview.ts";
import { fontFamilyPreview, fontWeightPreview, typographyPreview } from "./font-preview.ts";
import { gradientPreview } from "./gradient-preview.ts";
import type { Preview, TextPreview } from "./preview.ts";
import { shadowPreview } from "./shadow-preview.ts";

type ToPreview = (value: unknown) => Preview | undefined;

const PREVIEWS: ReadonlyMap<unknown, ToPreview> = new Map<unknown, ToPreview>([
  ["color", colorPreview],
  ["shadow", shadowPreview],
  ["gradient", gradientPreview],
  ["fontFamily", fontFamilyPreview],
  ["fontWeight", fontWeightPreview],
  ["typography", typographyPreview],
]);

const textPreview = (value: unknown): TextPreview => ({
  shape: "text",
  text: value === undefined ? "" : JSON.stringify(value),
});

export const previewOf = ({
  type,
  value,
}: {
  readonly type: unknown;
  readonly value: unknown;
}): Preview => PREVIEWS.get(type)?.(value) ?? textPreview(value);
