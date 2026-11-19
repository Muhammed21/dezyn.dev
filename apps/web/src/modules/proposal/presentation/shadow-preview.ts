import { z } from "zod";

import { SrgbHex } from "./color-preview.ts";
import { Length, PositiveLength } from "./length.ts";
import type { ShadowPreview } from "./preview.ts";

const ShadowLayer = z
  .object({
    color: SrgbHex,
    offsetX: Length,
    offsetY: Length,
    blur: PositiveLength,
    spread: Length,
    inset: z.boolean().optional(),
  })
  .transform(({ color, offsetX, offsetY, blur, spread, inset }) =>
    [...(inset === true ? ["inset"] : []), offsetX, offsetY, blur, spread, color].join(" "),
  );

const Shadow = z.union([ShadowLayer, z.array(ShadowLayer).min(1)]);

export const shadowPreview = (value: unknown): ShadowPreview | undefined => {
  const shadow = Shadow.safeParse(value);
  if (!shadow.success) {
    return undefined;
  }
  const text = [shadow.data].flat().join(", ");
  return { shape: "shadow", text, style: { boxShadow: text } };
};
