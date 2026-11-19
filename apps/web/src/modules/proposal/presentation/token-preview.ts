import { colorPreview } from "./color-preview.ts";
import type { Preview, TextPreview } from "./preview.ts";

type ToPreview = (value: unknown) => Preview | undefined;

const PREVIEWS: ReadonlyMap<unknown, ToPreview> = new Map([["color", colorPreview]]);

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
