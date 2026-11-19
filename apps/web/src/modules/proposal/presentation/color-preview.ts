import { z } from "zod";

import type { SwatchPreview } from "./preview.ts";

const Unit = z.number().min(0).max(1);

const byteOf = (unit: number) =>
  Math.round(unit * 255)
    .toString(16)
    .padStart(2, "0");

export const SrgbHex = z
  .object({
    colorSpace: z.literal("srgb"),
    components: z.tuple([Unit, Unit, Unit]),
    alpha: Unit.optional(),
  })
  .transform(
    ({ components, alpha = 1 }) =>
      `#${[...components, ...(alpha === 1 ? [] : [alpha])].map(byteOf).join("")}`,
  );

export const colorPreview = (value: unknown): SwatchPreview | undefined => {
  const hex = SrgbHex.safeParse(value);
  if (!hex.success) {
    return undefined;
  }
  return { shape: "swatch", text: hex.data, style: { backgroundColor: hex.data } };
};
