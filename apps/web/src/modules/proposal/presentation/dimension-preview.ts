import { LengthValue, lengthText } from "./length.ts";
import type { BarPreview, TextPreview } from "./preview.ts";

export const dimensionPreview = (value: unknown): BarPreview | TextPreview | undefined => {
  const dimension = LengthValue.safeParse(value);
  if (!dimension.success) {
    return undefined;
  }
  const text = lengthText(dimension.data);
  if (dimension.data.value < 0) {
    return { shape: "text", text };
  }
  return { shape: "bar", text, style: { width: text } };
};
